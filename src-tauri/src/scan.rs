//! 目录扫描编排：增量过滤、并行解析、写库与清理、进度事件。
//! 与 lib.rs 的关系：这里只管"扫"，状态（AppState.scanning/cancel）仍由入口持有。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use rayon::prelude::*;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::media::{self, MediaItem};
use crate::{cache, db, AppState};

pub fn has_media_ext(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| media::is_media_ext(&e.to_lowercase()))
        .unwrap_or(false)
}

/// 增量扫描的判定：这个文件要不要重新处理（解析元数据 + 重建缩略图）。
///
/// 两个条件缺一不可，因为索引与缩略图**存放在生命周期不同的目录**：
/// 索引在数据目录（不会被系统动），缩略图在缓存目录（macOS 会自行清理
/// `~/Library/Caches`，用户也可能手动清）。只比 mtime 的话，缓存被清而索引还在时
/// 每个文件都判定"未改动"而永久跳过——网格从此全是破图，点多少次重新扫描也修不好。
/// 缺缩略图即重建，顺带覆盖"首扫时 ffmpeg 缺失导致视频封面全失败、装好后重扫"。
fn needs_processing(cur_mtime: Option<i64>, indexed_mtime: Option<i64>, has_thumb: bool) -> bool {
    let unchanged = match (cur_mtime, indexed_mtime) {
        // 读不到 mtime 一律重新处理：0 哨兵会与旧记录的 0 互相掩护、永不重扫
        (None, _) => false,
        (Some(cur), Some(old)) => old == cur,
        (Some(_), None) => false,
    };
    !unchanged || !has_thumb
}

/// 缩略图缓存里现有的 id 集合。一次 read_dir 换掉逐文件 exists()——
/// 增量扫描要对每个文件查一次，大目录上百万次 stat 不可接受。
/// 生成中的临时文件（`<id>.<pid>-<n>.tmp.jpg`）去掉 .jpg 后不等于任何 id，天然不会被误认。
fn cached_thumb_ids() -> HashSet<String> {
    let Ok(entries) = std::fs::read_dir(cache::thumbs_dir()) else {
        return HashSet::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name();
            Some(name.to_str()?.strip_suffix(".jpg")?.to_string())
        })
        .collect()
}

/// 扫描一个目录：增量解析元数据、生成缩略图/封面、写入索引，过程中发送进度事件。
/// 拒绝并发扫描；可通过 `cancel_scan` 中断。
#[tauri::command]
pub async fn scan_directory(app: AppHandle, path: String) -> Result<usize, String> {
    {
        let state = app.state::<AppState>();
        if state.scanning.swap(true, Ordering::SeqCst) {
            // 返回 i18n key，前端按当前语言翻译
            return Err("backend.scanInProgress".into());
        }
        state.cancel.store(false, Ordering::SeqCst);
    }
    let app2 = app.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || scan_impl(app2, path)).await;
    // 无论成功失败都复位标志
    app.state::<AppState>().scanning.store(false, Ordering::SeqCst);
    joined.map_err(|e| e.to_string())?
}

/// 请求取消正在进行的扫描。
#[tauri::command]
pub fn cancel_scan(state: State<AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

fn scan_impl(app: AppHandle, root: String) -> Result<usize, String> {
    tracing::info!(root = %root, "扫描开始");
    // 守卫：root 必须是目录。否则没有路径以 "<root>/" 开头，
    // purge_outside_root 会把整库都当作“目录外”删光。
    if !Path::new(&root).is_dir() {
        return Err("backend.notDirectory".into());
    }
    // 入口即 canonicalize（与 lib.rs 的查看器入口一致）：索引里只存规范拼写，
    // 缓存 id、查看器删除、asset 放行不再面对同一文件的多种拼写。
    let root = Path::new(&root)
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(root);
    // 校验通过后才放行 asset 协议访问该目录树（被拒绝的路径不得进入 scope）：
    // 静态 scope 之外的根（如 /Users/Shared）不放行则视频无法播放、原图降级。
    crate::allow_asset_tree(&app, Path::new(&root));
    let cancel = app.state::<AppState>().cancel.clone();
    let mut conn = db::open().map_err(|e| {
        tracing::error!(error = %e, "打开数据库失败");
        e.to_string()
    })?;

    // 1. 收集目录下所有媒体文件。遍历错误（TCC 权限、网络卷抖动等）必须记录：
    //    出错子树不在 files 里，若照常执行步骤 5，其文件会被当作"已删除"误清索引。
    //    记录出错的具体路径，把"不参与清理"的范围缩到出错子树——外置卷必带的
    //    不可读 .Trashes 等系统目录若导致整体放弃清理，清理将永远无法执行。
    let mut error_paths: Vec<PathBuf> = Vec::new();
    let mut unscoped_errors = 0usize; // 定位不到路径的错误：无法限定范围，只能整体跳过清理
    let files: Vec<PathBuf> = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| match e {
            Ok(entry) => Some(entry),
            Err(err) => {
                tracing::warn!(error = %err, "扫描：目录遍历出错，跳过该项");
                match err.path() {
                    Some(p) => error_paths.push(p.to_path_buf()),
                    None => unscoped_errors += 1,
                }
                None
            }
        })
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| has_media_ext(p))
        .collect();

    // 2. 增量：跳过 mtime 未变、且缩略图仍在的文件（仅看当前 root 目录下的已有记录）
    let existing = db::existing_mtimes(&conn, &root).unwrap_or_default();
    let cached_thumbs = cached_thumb_ids();
    let to_process: Vec<PathBuf> = files
        .iter()
        .filter(|p| {
            let id = media::media_id(p);
            let cur_mtime = std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            needs_processing(
                cur_mtime,
                existing.get(&id).map(|(m, _)| *m),
                cached_thumbs.contains(&id),
            )
        })
        .cloned()
        .collect();

    let total = to_process.len();
    tracing::info!(files = files.len(), to_process = total, "扫描：开始处理");
    let _ = app.emit("scan-progress", json!({ "done": 0, "total": total }));

    // 3. 并行解析 + 生成缩略图/封面（rayon），实时上报进度；检查取消标志
    let counter = AtomicUsize::new(0);
    let items: Vec<MediaItem> = to_process
        .par_iter()
        .filter_map(|p| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let result = media::build_media(p);
            let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
            if n.is_multiple_of(16) || n == total {
                let _ = app.emit("scan-progress", json!({ "done": n, "total": total }));
            }
            result
        })
        .collect();

    // 4. 写入索引（即使被取消，也保留已处理的部分）
    if let Err(e) = db::upsert_media(&mut conn, &items) {
        tracing::error!(error = %e, count = items.len(), "写入索引失败");
        return Err(e.to_string());
    }

    // 5. 清理已删除的文件——仅在未取消时执行（取消时扫描不完整，删除不可靠）。
    //    遍历出错的子树同样不完整：其下的记录不参与"已删除"判定（按路径前缀排除），
    //    树内其余部分照常清理。`existing` 已限定在当前 root 下，不会误伤其他目录。
    let cancelled = cancel.load(Ordering::Relaxed);
    let walk_errors = error_paths.len() + unscoped_errors;
    if walk_errors > 0 {
        tracing::warn!(
            scoped = error_paths.len(),
            unscoped = unscoped_errors,
            "扫描：目录遍历有错误，出错子树不参与已删除清理"
        );
    }
    if !cancelled && unscoped_errors == 0 {
        let current_ids: HashSet<String> = files.iter().map(|p| media::media_id(p)).collect();
        let missing: Vec<String> = existing
            .iter()
            .filter(|(id, _)| !current_ids.contains(*id))
            .filter(|(_, (_, path))| {
                !error_paths.iter().any(|ep| Path::new(path).starts_with(ep))
            })
            .map(|(id, _)| id.clone())
            .collect();
        if !missing.is_empty() {
            db::delete_ids(&mut conn, &missing).map_err(|e| e.to_string())?;
            // 同步清理孤儿缩略图/预览缓存，避免缓存目录无限膨胀
            for id in &missing {
                let _ = std::fs::remove_file(cache::thumb_file(id));
                let _ = std::fs::remove_file(cache::preview_file(id));
            }
        }
    }

    // 贯彻“单目录”语义：把不属于当前 root 的旧索引及其缓存清掉。
    // 判定只看路径前缀、不依赖本次遍历结果，故与遍历错误无关，未取消即可执行。
    if !cancelled {
        match db::purge_outside_root(&mut conn, &root) {
            Ok(purged) => {
                for id in &purged {
                    let _ = std::fs::remove_file(cache::thumb_file(id));
                    let _ = std::fs::remove_file(cache::preview_file(id));
                }
                if !purged.is_empty() {
                    tracing::info!(count = purged.len(), "清理其他目录的旧索引");
                }
            }
            Err(e) => tracing::warn!(error = %e, "清理其他目录索引失败"),
        }
    }

    // 处理失败的文件数（仅未取消时有意义）
    let failed = if cancelled {
        0
    } else {
        total.saturating_sub(items.len())
    };
    if failed > 0 {
        tracing::warn!(failed, total, "部分文件处理失败（详见日志）");
    }
    tracing::info!(processed = items.len(), cancelled, failed, "扫描完成");
    let _ = app.emit(
        "scan-done",
        json!({
            "processed": items.len(),
            "total_files": files.len(),
            "cancelled": cancelled,
            "failed": failed,
            // 遍历出错的项目数：不可读子树的清理被跳过，前端要让用户知道
            "walk_errors": walk_errors,
        }),
    );
    Ok(items.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incremental_skips_only_when_indexed_and_thumb_present() {
        // mtime 一致 + 缩略图还在 → 唯一可以跳过的组合
        assert!(!needs_processing(Some(100), Some(100), true));
        // mtime 变了 → 重新处理
        assert!(needs_processing(Some(200), Some(100), true));
        // 没有索引记录（新文件）→ 处理
        assert!(needs_processing(Some(100), None, false));
        // 读不到 mtime → 处理（0 哨兵会与旧记录的 0 互相掩护、永不重扫）
        assert!(needs_processing(None, Some(100), true));
    }

    #[test]
    fn missing_thumb_forces_rebuild() {
        // 回归：索引在数据目录、缩略图在缓存目录，macOS 清理 ~/Library/Caches 后
        // 二者会不同步。只比 mtime 的话这些文件被永久跳过——网格全是破图，
        // 且点多少次"重新扫描"都修不好。
        assert!(needs_processing(Some(100), Some(100), false));
    }
}
