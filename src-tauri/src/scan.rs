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
    let cancel = app.state::<AppState>().cancel.clone();
    let mut conn = db::open().map_err(|e| {
        tracing::error!(error = %e, "打开数据库失败");
        e.to_string()
    })?;

    // 1. 收集目录下所有媒体文件
    let files: Vec<PathBuf> = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| has_media_ext(p))
        .collect();

    // 2. 增量：跳过 mtime 未变的文件（仅看当前 root 目录下的已有记录）
    let existing = db::existing_mtimes(&conn, &root).unwrap_or_default();
    let to_process: Vec<PathBuf> = files
        .iter()
        .filter(|p| {
            let id = media::media_id(p);
            let cur_mtime = std::fs::metadata(p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            match (cur_mtime, existing.get(&id)) {
                // 读不到 mtime 一律重新处理：0 哨兵会与旧记录的 0 互相掩护、永不重扫
                (None, _) => true,
                (Some(cur), Some(&old)) => old != cur,
                (Some(_), None) => true,
            }
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
    //    `existing` 已限定在当前 root 下，不会误伤其他目录的索引。
    let cancelled = cancel.load(Ordering::Relaxed);
    if !cancelled {
        let current_ids: HashSet<String> = files.iter().map(|p| media::media_id(p)).collect();
        let missing: Vec<String> = existing
            .keys()
            .filter(|id| !current_ids.contains(*id))
            .cloned()
            .collect();
        if !missing.is_empty() {
            db::delete_ids(&mut conn, &missing).map_err(|e| e.to_string())?;
            // 同步清理孤儿缩略图/预览缓存，避免缓存目录无限膨胀
            for id in &missing {
                let _ = std::fs::remove_file(cache::thumb_file(id));
                let _ = std::fs::remove_file(cache::preview_file(id));
            }
        }

        // 贯彻“单目录”语义：把不属于当前 root 的旧索引及其缓存清掉
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
        }),
    );
    Ok(items.len())
}
