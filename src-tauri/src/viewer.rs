//! 查看器模式（"打开方式"进入的独立窗口）的后端命令。
//!
//! 与主浏览器的最大差别：这里的文件多半**不在 SQLite 索引里**，所以全部命令
//! 都以"文件路径"为中心直接读文件系统，不依赖扫描/索引。

use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

use crate::media::{self, MediaItem};
use crate::{cache, db};

/// 兄弟文件的轻量条目（列表/切换用，不含 EXIF）。
#[derive(serde::Serialize)]
pub struct SiblingItem {
    pub path: String,
    pub filename: String,
    pub ext: String,
    /// "photo" | "video"
    pub kind: String,
}

#[derive(serde::Serialize)]
pub struct Siblings {
    pub items: Vec<SiblingItem>,
    /// 打开的文件在 items 中的下标（找不到时为 0）
    pub index: usize,
}

/// 列出同目录（不递归）的全部媒体文件，按文件名自然排序（近似访达）。
#[tauri::command]
pub fn list_siblings(path: String) -> Result<Siblings, String> {
    let file = PathBuf::from(&path);
    let dir = file
        .parent()
        .ok_or_else(|| "backend.notDirectory".to_string())?;
    let mut items: Vec<SiblingItem> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !entry.file_type().ok()?.is_file() {
                return None;
            }
            let p = entry.path();
            let ext = p.extension()?.to_str()?.to_lowercase();
            if !media::is_media_ext(&ext) {
                return None;
            }
            Some(SiblingItem {
                path: p.to_string_lossy().to_string(),
                filename: name,
                kind: media::kind_for_ext(&ext).into(),
                ext,
            })
        })
        .collect();
    items.sort_by(|a, b| natural_cmp(&a.filename, &b.filename));

    // 定位打开的文件：先精确比路径；不一致（符号链接等）再按 canonicalize 比
    let located = items
        .iter()
        .position(|it| it.path == path)
        .or_else(|| {
            let canon = file.canonicalize().ok()?;
            items
                .iter()
                .position(|it| Path::new(&it.path).canonicalize().ok().as_deref() == Some(&canon))
        });
    // 打开的文件被列表过滤掉了（隐藏文件如 .pano.jpg / ._xxx.jpg）：
    // 单独插入到自然排序位置——绝不能静默回落到第 0 项显示别的文件。
    let index = match located {
        Some(i) => i,
        None if file.is_file() => {
            let filename = file
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = file
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            let pos = items
                .partition_point(|it| natural_cmp(&it.filename, &filename) == Ordering::Less);
            items.insert(
                pos,
                SiblingItem {
                    path: path.clone(),
                    filename,
                    kind: media::kind_for_ext(&ext).into(),
                    ext,
                },
            );
            pos
        }
        // 文件已不存在（打开与列目录之间被删）：保持旧行为回落 0
        None => 0,
    };
    tracing::info!(dir = %dir.display(), count = items.len(), index, "查看器：列出同目录媒体");
    Ok(Siblings { items, index })
}

/// 单个文件的完整元数据（信息面板用）。不生成缩略图、不写库。
#[tauri::command]
pub async fn viewer_item(path: String) -> Result<MediaItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tracing::debug!(path = %path, "查看器：读取文件元数据");
        media::build_media_meta(Path::new(&path)).ok_or_else(|| "backend.readFailed".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// WebView 原生解码失败时的兜底：sips 全分辨率转 JPEG 到 viewer 缓存。
/// 返回缓存 id（前端拼 vpreview:// URL）。dst 比 src 新则直接命中缓存。
#[tauri::command]
pub async fn viewer_preview(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        // 正常调用链只会传绝对路径；相对路径（如 "-x.heic"）会被 sips
        // 当作命令行选项解析（参数注入），一律拒绝。
        if !src.is_absolute() {
            return Err("backend.readFailed".to_string());
        }
        let id = media::media_id(&src);
        let dst = cache::viewer_file(&id);
        let src_mtime = std::fs::metadata(&src)
            .map_err(|e| e.to_string())?
            .modified()
            .ok();
        let fresh = match (
            std::fs::metadata(&dst).and_then(|m| m.modified()).ok(),
            src_mtime,
        ) {
            (Some(d), Some(s)) => d >= s,
            (Some(_), None) => true,
            _ => false,
        };
        if !fresh {
            tracing::info!(path = %path, "查看器：sips 全分辨率转码兜底");
            media::sips_full_jpeg(&src, &dst)?;
        }
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 把文件移入废纸篓，并同步清掉索引记录与缩略图/预览/查看器缓存，
/// 最后通知主窗口刷新网格（主窗口不存在时静默忽略）。
///
/// id = 路径拼写哈希：同一文件经符号链接（/tmp → /private/tmp）或不同大小写
/// 拼写打开时，id 与扫描时不同。必须**趁文件还在**先 canonicalize，
/// 对原始拼写与规范拼写两个 id 都做清理，否则索引里留幽灵条目。
#[tauri::command]
pub async fn viewer_trash(app: AppHandle, path: String) -> Result<(), String> {
    let ids = tauri::async_runtime::spawn_blocking({
        let path = path.clone();
        move || -> Result<Vec<String>, String> {
            let p = Path::new(&path);
            let mut ids = vec![media::media_id(p)];
            if let Ok(canon) = p.canonicalize() {
                let cid = media::media_id(&canon);
                if !ids.contains(&cid) {
                    ids.push(cid);
                }
            }
            trash::delete(&path).map_err(|e| e.to_string())?;
            Ok(ids)
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    {
        let state = app.state::<crate::AppState>();
        let mut conn = crate::lock_db(&state.db);
        // 未被索引的文件删 0 行，无害
        if let Err(e) = db::delete_ids(&mut conn, &ids) {
            tracing::warn!(error = %e, path = %path, "删除索引记录失败");
        }
    }
    for id in &ids {
        let _ = std::fs::remove_file(cache::thumb_file(id));
        let _ = std::fs::remove_file(cache::preview_file(id));
        let _ = std::fs::remove_file(cache::viewer_file(id));
    }
    let _ = app.emit_to(
        "main",
        "media-trashed",
        serde_json::json!({ "ids": ids, "path": path }),
    );
    tracing::info!(path = %path, "已移入废纸篓");
    Ok(())
}

/// 文件名自然排序：忽略大小写，连续数字按数值比较（"img2" < "img10"），近似访达。
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ia = a.chars().peekable();
    let mut ib = b.chars().peekable();
    loop {
        match (ia.peek().copied(), ib.peek().copied()) {
            (None, None) => return a.cmp(b), // 全等（忽略大小写）时按原文比较保证稳定全序
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(&c) = ia.peek().filter(|c| c.is_ascii_digit()) {
                    na.push(c);
                    ia.next();
                }
                let mut nb = String::new();
                while let Some(&c) = ib.peek().filter(|c| c.is_ascii_digit()) {
                    nb.push(c);
                    ib.next();
                }
                // 去前导零后比长度再比字典序，避免超长数字串 parse 溢出
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta
                    .len()
                    .cmp(&tb.len())
                    .then_with(|| ta.cmp(tb))
                    .then_with(|| na.len().cmp(&nb.len()));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(ca), Some(cb)) => {
                let ord = ca.to_lowercase().cmp(cb.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                ia.next();
                ib.next();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_numeric_runs() {
        assert_eq!(natural_cmp("img2.jpg", "img10.jpg"), Ordering::Less);
        assert_eq!(natural_cmp("img10.jpg", "img2.jpg"), Ordering::Greater);
        assert_eq!(natural_cmp("IMG_001.jpg", "img_2.jpg"), Ordering::Less);
    }

    #[test]
    fn natural_case_insensitive() {
        assert_eq!(natural_cmp("Apple.jpg", "banana.jpg"), Ordering::Less);
        assert_eq!(natural_cmp("a.jpg", "A.jpg"), natural_cmp("a.jpg", "A.jpg")); // 稳定
        assert_ne!(natural_cmp("a.jpg", "A.jpg"), Ordering::Equal); // 全序，无并列
    }

    #[test]
    fn natural_leading_zeros() {
        assert_eq!(natural_cmp("img007.jpg", "img7.jpg"), Ordering::Greater);
        assert_eq!(natural_cmp("img007.jpg", "img08.jpg"), Ordering::Less);
    }
}
