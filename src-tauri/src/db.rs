//! SQLite 索引层：建表、写入照片记录、多维度查询、分面统计。
//!
//! 设计要点：扫描时一次性把元数据写进库，之后所有筛选/排序/分类都在
//! SQL 里完成，前端永远不直接读硬盘——这是"检索丝滑"的基础。

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, types::ToSql, Connection};
use serde::{Deserialize, Serialize};

use crate::media::MediaItem;

/// 打开（并初始化）索引数据库
pub fn open() -> rusqlite::Result<Connection> {
    let conn = Connection::open(crate::cache::db_path())?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS photos (
            id           TEXT PRIMARY KEY,
            path         TEXT NOT NULL UNIQUE,
            filename     TEXT NOT NULL,
            dir          TEXT NOT NULL,
            ext          TEXT NOT NULL,
            kind         TEXT NOT NULL DEFAULT 'photo',
            file_size    INTEGER NOT NULL,
            mtime        INTEGER NOT NULL,
            width        INTEGER,
            height       INTEGER,
            duration     REAL,
            taken_at     INTEGER,
            camera_make  TEXT,
            camera_model TEXT,
            lens         TEXT,
            iso          INTEGER,
            aperture     REAL,
            shutter      TEXT,
            focal_length REAL,
            gps_lat      REAL,
            gps_lon      REAL,
            orientation  INTEGER
        );
        "#,
    )?;
    // 兼容旧库：补列后再建索引（否则旧表上的 idx_kind 找不到列）。
    // 仅忽略“列已存在”，其余错误（磁盘满/库损坏）上抛，避免被静默吞掉。
    for sql in [
        "ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'",
        "ALTER TABLE photos ADD COLUMN duration REAL",
    ] {
        if let Err(e) = conn.execute(sql, []) {
            if !e.to_string().contains("duplicate column name") {
                return Err(e);
            }
        }
    }
    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_taken   ON photos(taken_at);
        CREATE INDEX IF NOT EXISTS idx_camera  ON photos(camera_model);
        CREATE INDEX IF NOT EXISTS idx_ext     ON photos(ext);
        CREATE INDEX IF NOT EXISTS idx_lens    ON photos(lens);
        CREATE INDEX IF NOT EXISTS idx_kind    ON photos(kind);
        "#,
    )

}

/// 读取**当前 root 目录下**已有照片的 (id -> mtime)，用于增量扫描时跳过未改动文件、
/// 以及计算哪些文件已被删除。按 root 限定可避免扫描新目录时误删其他目录的索引。
pub fn existing_mtimes(conn: &Connection, root: &str) -> rusqlite::Result<HashMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT id, mtime FROM photos WHERE path LIKE ? ESCAPE '\\'")?;
    let rows = stmt.query_map([root_like_pattern(root)], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (id, mtime) = row?;
        map.insert(id, mtime);
    }
    Ok(map)
}

/// 批量写入（UPSERT）照片记录，单事务以保证速度。
pub fn upsert_media(conn: &mut Connection, photos: &[MediaItem]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            r#"
            INSERT INTO photos (id, path, filename, dir, ext, kind, file_size, mtime, width, height,
                duration, taken_at, camera_make, camera_model, lens, iso, aperture, shutter,
                focal_length, gps_lat, gps_lon, orientation)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
            ON CONFLICT(id) DO UPDATE SET
                path=excluded.path, filename=excluded.filename, dir=excluded.dir, ext=excluded.ext,
                kind=excluded.kind, file_size=excluded.file_size, mtime=excluded.mtime,
                width=excluded.width, height=excluded.height, duration=excluded.duration,
                taken_at=excluded.taken_at, camera_make=excluded.camera_make,
                camera_model=excluded.camera_model, lens=excluded.lens, iso=excluded.iso,
                aperture=excluded.aperture, shutter=excluded.shutter, focal_length=excluded.focal_length,
                gps_lat=excluded.gps_lat, gps_lon=excluded.gps_lon, orientation=excluded.orientation
            "#,
        )?;
        for p in photos {
            stmt.execute(params![
                p.id, p.path, p.filename, p.dir, p.ext, p.kind, p.file_size, p.mtime, p.width,
                p.height, p.duration, p.taken_at, p.camera_make, p.camera_model, p.lens, p.iso,
                p.aperture, p.shutter, p.focal_length, p.gps_lat, p.gps_lon, p.orientation
            ])?;
        }
    }
    tx.commit()
}

/// 删除不在指定 root 目录下的所有记录，返回被删 id（用于清理其缓存文件）。
/// 用于贯彻“单目录”语义：切换/扫描新目录时，把上一目录的索引清出，避免隐形堆积。
pub fn purge_outside_root(conn: &mut Connection, root: &str) -> rusqlite::Result<Vec<String>> {
    let pattern = root_like_pattern(root);
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM photos WHERE path NOT LIKE ? ESCAPE '\\'")?;
        let rows = stmt.query_map([&pattern], |r| r.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    if !ids.is_empty() {
        conn.execute("DELETE FROM photos WHERE path NOT LIKE ? ESCAPE '\\'", [&pattern])?;
    }
    Ok(ids)
}

/// 删除指定 id 的记录（清理已不存在的文件）
pub fn delete_ids(conn: &mut Connection, ids: &[String]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare("DELETE FROM photos WHERE id = ?1")?;
        for id in ids {
            stmt.execute([id])?;
        }
    }
    tx.commit()
}

/// 前端传来的检索条件
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
pub struct Filter {
    /// 限定某个根目录（path 前缀），为空则查全部
    pub root: Option<String>,
    /// 文件名关键字
    pub text: Option<String>,
    /// 当前“分组查看”所选的维度（kind/year/camera/focal/iso/format/gps），为空则看全部。
    /// 全局单选：同一时刻只激活一个分组，切换即替换。见 `dim_sql`。
    pub group_dim: Option<String>,
    /// 该维度下所选的分类 key（如 "2024" / "wide" / "unknown"）。
    pub group_key: Option<String>,
    /// 排序字段：taken_at | filename | file_size | width | iso | focal_length
    pub sort_by: Option<String>,
    /// asc | desc
    pub sort_dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// 把一个分组维度映射成「对每行算出其所属分类 key」的 SQL 表达式。
///
/// 关键设计：**facets 聚合**与 **filter 过滤**复用同一个表达式——
/// facets 用它 `GROUP BY` 出各分类及数量；filter 用 `<expr> = ?` 精确匹配所选分类。
/// 表达式保证永不为 NULL：缺失信息一律归入 `'unknown'`，从而“未知”成为可点选的正常分类。
///
/// 数值维度（焦距/感光度）在此用 `CASE WHEN` 切成有语义的区间，是“智能分类”的核心：
/// 把连续数值变成「广角/标准/长焦」这种人脑可读的桶。
fn dim_sql(dim: &str) -> Option<&'static str> {
    Some(match dim {
        "kind" => "kind",
        "year" => "COALESCE(CAST(strftime('%Y', taken_at, 'unixepoch') AS TEXT), 'unknown')",
        "camera" => "COALESCE(NULLIF(camera_make, ''), 'unknown')",
        "format" => {
            "CASE WHEN kind = 'video' THEN 'video' \
             WHEN lower(ext) IN ('cr2','cr3','nef','arw','dng','raf','rw2','orf','pef','srw','raw') THEN 'raw' \
             WHEN lower(ext) IN ('jpg','jpeg') THEN 'jpeg' \
             WHEN lower(ext) IN ('heic','heif') THEN 'heic' \
             WHEN lower(ext) = 'png' THEN 'png' \
             ELSE 'other' END"
        }
        "gps" => "CASE WHEN gps_lat IS NOT NULL THEN 'has' ELSE 'none' END",
        _ => return None,
    })
}

/// 转义 LIKE 模式里的元字符（配合 `ESCAPE '\'` 使用），避免用户输入里的
/// `%` / `_` 被当作通配符。
fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// 目录前缀模式：限定为该目录“下”的文件（带分隔符），避免 `/a/Photos`
/// 误匹配到 `/a/PhotosBackup`。
fn root_like_pattern(root: &str) -> String {
    format!("{}/%", like_escape(root.trim_end_matches('/')))
}

/// 把 Filter 编译成 SQL 的 WHERE 子句与参数。
fn build_where(f: &Filter) -> (String, Vec<Box<dyn ToSql>>) {
    let mut clauses: Vec<String> = vec!["1=1".into()];
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();

    if let Some(root) = &f.root {
        if !root.is_empty() {
            clauses.push("path LIKE ? ESCAPE '\\'".into());
            args.push(Box::new(root_like_pattern(root)));
        }
    }
    if let Some(t) = &f.text {
        if !t.is_empty() {
            clauses.push("filename LIKE ? ESCAPE '\\'".into());
            args.push(Box::new(format!("%{}%", like_escape(t))));
        }
    }
    // 分组查看：全局单选，只按当前所选维度的某个分类过滤。
    // 复用 dim_sql 的表达式，"未知"分类（group_key = "unknown"）天然命中缺失值。
    if let (Some(dim), Some(key)) = (&f.group_dim, &f.group_key) {
        if !dim.is_empty() && !key.is_empty() {
            if let Some(expr) = dim_sql(dim) {
                clauses.push(format!("{expr} = ?"));
                args.push(Box::new(key.clone()));
            }
        }
    }

    (clauses.join(" AND "), args)
}

/// 白名单排序列，防 SQL 注入
fn sort_column(s: &Option<String>) -> &'static str {
    match s.as_deref() {
        Some("filename") => "filename",
        Some("file_size") => "file_size",
        Some("width") => "width",
        Some("iso") => "iso",
        Some("focal_length") => "focal_length",
        Some("mtime") => "mtime",
        _ => "taken_at",
    }
}

pub fn query(conn: &Connection, f: &Filter) -> rusqlite::Result<Vec<MediaItem>> {
    let (where_sql, args) = build_where(f);
    let col = sort_column(&f.sort_by);
    let dir = if f.sort_dir.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };
    // 范围保护：避免负值 limit 在 SQLite 中表示“无限制”而意外拉全表
    let limit = f.limit.unwrap_or(100_000).clamp(0, 1_000_000);
    let offset = f.offset.unwrap_or(0).max(0);

    // 排序列为空值时排到最后
    let sql = format!(
        "SELECT id, path, filename, dir, ext, kind, file_size, mtime, width, height, duration,
                taken_at, camera_make, camera_model, lens, iso, aperture, shutter, focal_length,
                gps_lat, gps_lon, orientation
         FROM photos WHERE {where_sql}
         ORDER BY ({col} IS NULL), {col} {dir}
         LIMIT {limit} OFFSET {offset}"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter().map(|b| b.as_ref())), row_to_item)?;
    rows.collect()
}

fn row_to_item(r: &rusqlite::Row) -> rusqlite::Result<MediaItem> {
    Ok(MediaItem {
        id: r.get(0)?,
        path: r.get(1)?,
        filename: r.get(2)?,
        dir: r.get(3)?,
        ext: r.get(4)?,
        kind: r.get(5)?,
        file_size: r.get(6)?,
        mtime: r.get(7)?,
        width: r.get(8)?,
        height: r.get(9)?,
        duration: r.get(10)?,
        taken_at: r.get(11)?,
        camera_make: r.get(12)?,
        camera_model: r.get(13)?,
        lens: r.get(14)?,
        iso: r.get(15)?,
        aperture: r.get(16)?,
        shutter: r.get(17)?,
        focal_length: r.get(18)?,
        gps_lat: r.get(19)?,
        gps_lon: r.get(20)?,
        orientation: r.get(21)?,
    })
}

/// 单张照片的完整信息（大图详情用）
pub fn get_one(conn: &Connection, id: &str) -> rusqlite::Result<Option<MediaItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, dir, ext, kind, file_size, mtime, width, height, duration,
                taken_at, camera_make, camera_model, lens, iso, aperture, shutter, focal_length,
                gps_lat, gps_lon, orientation FROM photos WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map([id], row_to_item)?;
    match rows.next() {
        Some(p) => Ok(Some(p?)),
        None => Ok(None),
    }
}

/// 一个分类项：稳定 key（用于过滤）+ 展示用中文标签 + 数量
#[derive(Serialize)]
pub struct FacetItem {
    pub key: String,
    pub label: String,
    pub count: i64,
}

/// 一个分组维度：维度标识 + 中文标题 + 其下各分类
#[derive(Serialize)]
pub struct FacetGroup {
    pub dim: String,
    pub title: String,
    pub items: Vec<FacetItem>,
}

/// 侧边栏“分组查看”所需的全部统计
#[derive(Serialize)]
pub struct Facets {
    pub total: i64,
    pub groups: Vec<FacetGroup>,
}

/// 参与分组查看的维度，按侧边栏展示顺序排列。
const FACET_DIMS: &[&str] = &["kind", "year", "camera", "format", "gps"];

/// 维度的中文标题
fn dim_title(dim: &str) -> &'static str {
    match dim {
        "kind" => "类型",
        "year" => "拍摄时间",
        "camera" => "相机",
        "format" => "格式",
        "gps" => "定位",
        _ => "",
    }
}

/// 枚举型维度的固定语义顺序（数值/类别桶按此排，而非按数量）。
/// year / camera 不在此列——它们按数据（年份/数量）排序。
fn dim_order(dim: &str) -> Option<&'static [&'static str]> {
    Some(match dim {
        "kind" => &["photo", "video"],
        "format" => &["raw", "jpeg", "heic", "png", "video", "other"],
        "gps" => &["has", "none"],
        _ => return None,
    })
}

/// 某维度下某分类 key 的中文展示标签。
fn dim_label(dim: &str, key: &str) -> String {
    let unknown = "未知".to_string();
    match dim {
        "kind" => if key == "video" { "视频" } else { "照片" }.to_string(),
        "year" => if key == "unknown" { unknown } else { format!("{key} 年") },
        "camera" => if key == "unknown" { unknown } else { key.to_string() },
        "format" => match key {
            "raw" => "RAW",
            "jpeg" => "JPEG",
            "heic" => "HEIC",
            "png" => "PNG",
            "video" => "视频",
            "other" => "其它",
            _ => key,
        }
        .to_string(),
        "gps" => match key {
            "has" => "有定位",
            "none" => "无定位",
            _ => "未知",
        }
        .to_string(),
        _ => key.to_string(),
    }
}

/// 计算各维度的分类统计。受 root 限制，但不受当前分组选择影响——
/// 这样用户切换分组后，所有维度的可选分类与数量仍是“全量视图”。
pub fn facets(conn: &Connection, root: &Option<String>) -> rusqlite::Result<Facets> {
    let f = Filter {
        root: root.clone(),
        ..Default::default()
    };
    let (where_sql, args) = build_where(&f);

    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM photos WHERE {where_sql}"),
        params_from_iter(args.iter().map(|b| b.as_ref())),
        |r| r.get(0),
    )?;

    // 某维度的 (分类 key -> 数量)，按数量降序返回
    let counts = |dim: &str| -> rusqlite::Result<Vec<(String, i64)>> {
        let expr = dim_sql(dim).expect("FACET_DIMS 内的维度必有表达式");
        let sql = format!(
            "SELECT {expr} AS k, COUNT(*) AS c FROM photos
             WHERE {where_sql} GROUP BY k ORDER BY c DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params_from_iter(args.iter().map(|b| b.as_ref())),
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )?;
        rows.collect()
    };

    let mut groups = Vec::with_capacity(FACET_DIMS.len());
    for &dim in FACET_DIMS {
        let raw = counts(dim)?;
        let map: HashMap<String, i64> = raw.iter().cloned().collect();

        // 确定分类的展示顺序
        let keys: Vec<String> = match dim_order(dim) {
            // 枚举维度：按语义顺序，仅保留有数据的桶
            Some(order) => order
                .iter()
                .filter(|k| map.contains_key(**k))
                .map(|k| k.to_string())
                .collect(),
            None => {
                // year：年份降序，未知垫底；camera：保持数量降序，未知垫底
                let mut keys: Vec<String> = raw.iter().map(|(k, _)| k.clone()).collect();
                if dim == "year" {
                    keys.sort_by(|a, b| match (a.as_str(), b.as_str()) {
                        ("unknown", _) => std::cmp::Ordering::Greater,
                        (_, "unknown") => std::cmp::Ordering::Less,
                        _ => b.cmp(a),
                    });
                } else {
                    let (mut normal, unknown): (Vec<_>, Vec<_>) =
                        keys.into_iter().partition(|k| k != "unknown");
                    normal.extend(unknown);
                    keys = normal;
                }
                keys
            }
        };

        let items: Vec<FacetItem> = keys
            .iter()
            .map(|k| FacetItem {
                key: k.clone(),
                label: dim_label(dim, k),
                count: *map.get(k).unwrap_or(&0),
            })
            .collect();
        groups.push(FacetGroup {
            dim: dim.to_string(),
            title: dim_title(dim).to_string(),
            items,
        });
    }

    Ok(Facets { total, groups })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_escape_metachars() {
        assert_eq!(like_escape("a%b_c"), "a\\%b\\_c");
        assert_eq!(like_escape("back\\slash"), "back\\\\slash");
        assert_eq!(like_escape("plain"), "plain");
    }

    #[test]
    fn root_pattern_appends_separator() {
        // 带/不带尾斜杠都归一化为“目录下”
        assert_eq!(root_like_pattern("/a/Photos/"), "/a/Photos/%");
        assert_eq!(root_like_pattern("/a/Photos"), "/a/Photos/%");
        // 不会误匹配兄弟目录 PhotosBackup（因为多了分隔符）
        assert!(!root_like_pattern("/a/Photos").contains("PhotosBackup"));
        // 路径里的元字符被转义
        assert_eq!(root_like_pattern("/a/p%x"), "/a/p\\%x/%");
    }

    #[test]
    fn query_builds_for_empty_filter() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        let res = query(&conn, &Filter::default()).unwrap();
        assert!(res.is_empty());
    }

    #[test]
    fn schema_has_kind_and_duration() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // facets 依赖 kind 列；能跑通即说明迁移/建表正确
        let f = facets(&conn, &None).unwrap();
        assert_eq!(f.total, 0);
    }

    fn item(id: &str, path: &str, kind: &str, ext: &str) -> MediaItem {
        MediaItem {
            id: id.into(),
            path: path.into(),
            filename: "x".into(),
            dir: "d".into(),
            ext: ext.into(),
            kind: kind.into(),
            ..Default::default()
        }
    }

    #[test]
    fn upsert_query_roundtrip() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        let mut photo = item("a", "/lib/a.jpg", "photo", "jpg");
        photo.taken_at = Some(1_700_000_000);
        let mut video = item("b", "/lib/b.mp4", "video", "mp4");
        video.duration = Some(12.5);
        upsert_media(&mut conn, &[photo.clone(), video]).unwrap();

        // 全量 + 列对齐（22 列写入/读取一致，否则会在这里崩）
        assert_eq!(query(&conn, &Filter::default()).unwrap().len(), 2);

        // 分组查看：按类型 = 视频
        let only_video = query(
            &conn,
            &Filter {
                group_dim: Some("kind".into()),
                group_key: Some("video".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(only_video.len(), 1);
        assert_eq!(only_video[0].id, "b");
        assert_eq!(only_video[0].duration, Some(12.5));

        // 同 id upsert 更新
        let mut photo2 = photo;
        photo2.filename = "a2.jpg".into();
        upsert_media(&mut conn, &[photo2]).unwrap();
        assert_eq!(get_one(&conn, "a").unwrap().unwrap().filename, "a2.jpg");

        // 分面：kind 维度应有 photo / video 两个分类
        let f = facets(&conn, &None).unwrap();
        assert_eq!(f.total, 2);
        let kinds = f.groups.iter().find(|g| g.dim == "kind").unwrap();
        assert_eq!(kinds.items.len(), 2);
    }

    #[test]
    fn groups_classify_and_unknown() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();

        // 两张 Apple + 一张无品牌（相机未知）
        let mut a = item("a", "/lib/a.jpg", "photo", "jpg");
        a.camera_make = Some("Apple".into());
        let mut b = item("b", "/lib/b.jpg", "photo", "jpg");
        b.camera_make = Some("Apple".into());
        let no_cam = item("n", "/lib/n.jpg", "photo", "jpg"); // camera_make = None
        upsert_media(&mut conn, &[a, b, no_cam]).unwrap();

        // 相机维度：Apple（有数据靠前）+ 未知（垫底）
        let f = facets(&conn, &None).unwrap();
        let cam = f.groups.iter().find(|g| g.dim == "camera").unwrap();
        let keys: Vec<&str> = cam.items.iter().map(|i| i.key.as_str()).collect();
        assert_eq!(keys, vec!["Apple", "unknown"]);
        assert_eq!(cam.items.last().unwrap().label, "未知");

        // 过滤“相机未知”应只命中没有品牌的那张
        let unknown = query(
            &conn,
            &Filter {
                group_dim: Some("camera".into()),
                group_key: Some("unknown".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].id, "n");
    }

    #[test]
    fn purge_outside_root_keeps_only_current() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        upsert_media(
            &mut conn,
            &[
                item("a", "/lib/A/1.jpg", "photo", "jpg"),
                item("b", "/lib/B/1.jpg", "photo", "jpg"),
            ],
        )
        .unwrap();
        let purged = purge_outside_root(&mut conn, "/lib/A").unwrap();
        assert_eq!(purged, vec!["b".to_string()]);
        let all = query(&conn, &Filter::default()).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "a");
    }
}
