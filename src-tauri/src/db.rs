//! SQLite 索引层：建表、写入照片记录、多维度查询、分面统计。
//!
//! 设计要点：扫描时一次性把元数据写进库，之后所有筛选/排序/分类都在
//! SQL 里完成，前端永远不直接读硬盘——这是"检索丝滑"的基础。

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, types::ToSql, Connection};
use serde::{Deserialize, Serialize};

use crate::media::Photo;

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
    // 兼容旧库：先补列（已存在则忽略报错），再建索引——否则旧表上的 idx_kind 会找不到列
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo'", []);
    let _ = conn.execute("ALTER TABLE photos ADD COLUMN duration REAL", []);
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
pub fn upsert_photos(conn: &mut Connection, photos: &[Photo]) -> rusqlite::Result<()> {
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
    pub years: Vec<i64>,
    pub cameras: Vec<String>,
    pub lenses: Vec<String>,
    pub formats: Vec<String>,
    /// 媒体类型：photo / video
    pub kinds: Vec<String>,
    /// 仅看有 GPS 的
    pub has_gps: bool,
    /// 排序字段：taken_at | filename | file_size | width | iso | focal_length
    pub sort_by: Option<String>,
    /// asc | desc
    pub sort_dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
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
    if !f.years.is_empty() {
        let ph = vec!["?"; f.years.len()].join(",");
        clauses.push(format!(
            "CAST(strftime('%Y', taken_at, 'unixepoch') AS INTEGER) IN ({ph})"
        ));
        for y in &f.years {
            args.push(Box::new(*y));
        }
    }
    if !f.cameras.is_empty() {
        let ph = vec!["?"; f.cameras.len()].join(",");
        clauses.push(format!("camera_model IN ({ph})"));
        for c in &f.cameras {
            args.push(Box::new(c.clone()));
        }
    }
    if !f.lenses.is_empty() {
        let ph = vec!["?"; f.lenses.len()].join(",");
        clauses.push(format!("lens IN ({ph})"));
        for l in &f.lenses {
            args.push(Box::new(l.clone()));
        }
    }
    if !f.formats.is_empty() {
        let ph = vec!["?"; f.formats.len()].join(",");
        clauses.push(format!("ext IN ({ph})"));
        for e in &f.formats {
            args.push(Box::new(e.clone()));
        }
    }
    if !f.kinds.is_empty() {
        let ph = vec!["?"; f.kinds.len()].join(",");
        clauses.push(format!("kind IN ({ph})"));
        for k in &f.kinds {
            args.push(Box::new(k.clone()));
        }
    }
    if f.has_gps {
        clauses.push("gps_lat IS NOT NULL".into());
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

pub fn query(conn: &Connection, f: &Filter) -> rusqlite::Result<Vec<Photo>> {
    let (where_sql, args) = build_where(f);
    let col = sort_column(&f.sort_by);
    let dir = if f.sort_dir.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };
    let limit = f.limit.unwrap_or(100_000);
    let offset = f.offset.unwrap_or(0);

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
    let rows = stmt.query_map(params_from_iter(args.iter().map(|b| b.as_ref())), row_to_photo)?;
    rows.collect()
}

fn row_to_photo(r: &rusqlite::Row) -> rusqlite::Result<Photo> {
    Ok(Photo {
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
pub fn get_one(conn: &Connection, id: &str) -> rusqlite::Result<Option<Photo>> {
    let mut stmt = conn.prepare(
        "SELECT id, path, filename, dir, ext, kind, file_size, mtime, width, height, duration,
                taken_at, camera_make, camera_model, lens, iso, aperture, shutter, focal_length,
                gps_lat, gps_lon, orientation FROM photos WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map([id], row_to_photo)?;
    match rows.next() {
        Some(p) => Ok(Some(p?)),
        None => Ok(None),
    }
}

/// 一个分面项：取值 + 数量
#[derive(Serialize)]
pub struct FacetItem {
    pub value: String,
    pub count: i64,
}

/// 侧边栏筛选所需的全部分面统计
#[derive(Serialize)]
pub struct Facets {
    pub total: i64,
    pub kinds: Vec<FacetItem>,
    pub years: Vec<FacetItem>,
    pub cameras: Vec<FacetItem>,
    pub lenses: Vec<FacetItem>,
    pub formats: Vec<FacetItem>,
    pub with_gps: i64,
}

/// 计算分面。会受 root 限制，但不受其他筛选影响（这样用户能看到全部可选项）。
pub fn facets(conn: &Connection, root: &Option<String>) -> rusqlite::Result<Facets> {
    // 复用 build_where，但只保留 root 条件
    let f = Filter {
        root: root.clone(),
        ..Default::default()
    };
    let (where_sql, args) = build_where(&f);

    let group = |expr: &str, where_extra: &str| -> rusqlite::Result<Vec<FacetItem>> {
        let sql = format!(
            "SELECT {expr} AS v, COUNT(*) AS c FROM photos
             WHERE {where_sql} {where_extra}
             GROUP BY v ORDER BY c DESC"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params_from_iter(args.iter().map(|b| b.as_ref())),
            |r| {
                Ok(FacetItem {
                    value: r.get::<_, String>(0)?,
                    count: r.get(1)?,
                })
            },
        )?;
        rows.collect()
    };

    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM photos WHERE {where_sql}"),
        params_from_iter(args.iter().map(|b| b.as_ref())),
        |r| r.get(0),
    )?;
    let with_gps: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM photos WHERE {where_sql} AND gps_lat IS NOT NULL"),
        params_from_iter(args.iter().map(|b| b.as_ref())),
        |r| r.get(0),
    )?;

    Ok(Facets {
        total,
        kinds: group("kind", "")?,
        years: group(
            "CAST(strftime('%Y', taken_at, 'unixepoch') AS TEXT)",
            "AND taken_at IS NOT NULL",
        )?,
        cameras: group("camera_model", "AND camera_model IS NOT NULL")?,
        lenses: group("lens", "AND lens IS NOT NULL")?,
        formats: group("ext", "")?,
        with_gps,
    })
}
