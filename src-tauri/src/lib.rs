//! Tauri 应用入口：状态管理、命令、自定义媒体协议（缩略图/封面/预览）、目录扫描。

mod cache;
mod db;
mod logging;
mod media;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use rayon::prelude::*;
use serde_json::json;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use db::{Facets, Filter};
use media::MediaItem;

/// 全局状态。
/// - `db`：用于查询的共享连接（扫描走独立连接，靠 SQLite WAL 并发读写）。
/// - `scanning`：是否有扫描在进行，用于拒绝并发扫描。
/// - `cancel`：取消标志，扫描循环会检查它（Arc 以便安全地共享进 rayon 线程）。
struct AppState {
    db: Mutex<rusqlite::Connection>,
    scanning: AtomicBool,
    cancel: Arc<AtomicBool>,
}

fn has_media_ext(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| media::is_media_ext(&e.to_lowercase()))
        .unwrap_or(false)
}

/// 扫描一个目录：增量解析元数据、生成缩略图/封面、写入索引，过程中发送进度事件。
/// 拒绝并发扫描；可通过 `cancel_scan` 中断。
#[tauri::command]
async fn scan_directory(app: AppHandle, path: String) -> Result<usize, String> {
    {
        let state = app.state::<AppState>();
        if state.scanning.swap(true, Ordering::SeqCst) {
            return Err("已有扫描正在进行，请稍候".into());
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
fn cancel_scan(state: State<AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// 视频功能是否可用（依赖 ffprobe/ffmpeg）。前端据此提示用户。
#[tauri::command]
fn video_support() -> bool {
    let ok = media::has_video_tools();
    tracing::info!(available = ok, "视频工具(ffprobe/ffmpeg)检测");
    ok
}

/// 运行环境与各目录地址（便于诊断与定位日志/缓存）。
#[derive(serde::Serialize)]
struct AppInfo {
    env: String,
    data_dir: String,
    cache_dir: String,
    log_dir: String,
    db_path: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        env: cache::ENV_NAME.to_string(),
        data_dir: cache::data_dir().display().to_string(),
        cache_dir: cache::cache_dir().display().to_string(),
        log_dir: cache::logs_dir().display().to_string(),
        db_path: cache::db_path().display().to_string(),
    }
}

fn scan_impl(app: AppHandle, root: String) -> Result<usize, String> {
    tracing::info!(root = %root, "扫描开始");
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
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            match existing.get(&id) {
                Some(&old) => old != cur_mtime,
                None => true,
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
            if n % 16 == 0 || n == total {
                let _ = app.emit("scan-progress", json!({ "done": n, "total": total }));
            }
            result
        })
        .collect();

    // 4. 写入索引（即使被取消，也保留已处理的部分）
    if let Err(e) = db::upsert_photos(&mut conn, &items) {
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
    }

    tracing::info!(processed = items.len(), cancelled, "扫描完成");
    let _ = app.emit(
        "scan-done",
        json!({ "processed": items.len(), "total_files": files.len(), "cancelled": cancelled }),
    );
    Ok(items.len())
}

#[tauri::command]
fn query_photos(state: State<AppState>, filter: Filter) -> Result<Vec<MediaItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::query(&conn, &filter).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_facets(state: State<AppState>, root: Option<String>) -> Result<Facets, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::facets(&conn, &root).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_photo(state: State<AppState>, id: String) -> Result<Option<MediaItem>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_one(&conn, &id).map_err(|e| e.to_string())
}

/// 懒生成大图预览，返回是否就绪。
#[tauri::command]
fn ensure_preview(state: State<AppState>, id: String) -> Result<bool, String> {
    let item = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_one(&conn, &id).map_err(|e| e.to_string())?
    };
    match item {
        // 视频不生成预览图（前端直接播放原始文件）
        Some(p) if p.kind != "video" => Ok(media::ensure_preview(
            Path::new(&p.path),
            &p.id,
            &p.ext,
            p.orientation,
        )),
        _ => Ok(false),
    }
}

/// 在系统文件管理器（Finder）中显示该媒体文件
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 注册一个读取缓存图片目录的自定义协议处理器。
/// `scheme://localhost/<id>.jpg` 会被映射到 `dir/<id>.jpg` 并以 image/jpeg 返回。
fn image_protocol<R: tauri::Runtime>(
    dir_fn: fn() -> PathBuf,
) -> impl Fn(tauri::UriSchemeContext<'_, R>, tauri::http::Request<Vec<u8>>, tauri::UriSchemeResponder)
       + Send
       + Sync
       + 'static {
    move |_ctx, request, responder| {
        let rel = request.uri().path().trim_start_matches('/').to_string();
        let base = dir_fn();
        let requested = base.join(rel);
        std::thread::spawn(move || {
            // 防路径穿越：规范化后必须仍位于缓存目录内（合法请求始终是 <id>.jpg）。
            let in_scope = match (base.canonicalize(), requested.canonicalize()) {
                (Ok(b), Ok(r)) => r.starts_with(&b),
                _ => false,
            };
            let response = match in_scope.then(|| std::fs::read(&requested)) {
                Some(Ok(bytes)) => tauri::http::Response::builder()
                    .header("Content-Type", "image/jpeg")
                    .header("Cache-Control", "max-age=31536000")
                    .body(bytes)
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
                _ => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
            };
            responder.respond(response);
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    cache::ensure_dirs();
    cache::migrate_previews();
    logging::init();
    tracing::info!(env = cache::ENV_NAME, "应用启动");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("thumb", image_protocol(cache::thumbs_dir))
        .register_asynchronous_uri_scheme_protocol("preview", image_protocol(cache::previews_dir))
        .setup(|app| {
            let conn = db::open().map_err(|e| format!("无法初始化数据库: {e}"))?;
            app.manage(AppState {
                db: Mutex::new(conn),
                scanning: AtomicBool::new(false),
                cancel: Arc::new(AtomicBool::new(false)),
            });

            // 原生菜单栏：在默认菜单（含 退出/复制/粘贴 等）基础上追加“目录”子菜单
            let h = app.handle().clone();
            let menu = Menu::default(&h)?;
            let open_data = MenuItem::with_id(&h, "open_data", "打开数据目录", true, None::<&str>)?;
            let open_cache =
                MenuItem::with_id(&h, "open_cache", "打开缓存目录", true, None::<&str>)?;
            let open_logs = MenuItem::with_id(&h, "open_logs", "打开日志目录", true, None::<&str>)?;
            let dirs = Submenu::with_items(&h, "目录", true, &[&open_data, &open_cache, &open_logs])?;
            menu.append(&dirs)?;
            app.set_menu(menu)?;
            app.on_menu_event(|_app, event| {
                let dir = match event.id().as_ref() {
                    "open_data" => cache::data_dir(),
                    "open_cache" => cache::cache_dir(),
                    "open_logs" => cache::logs_dir(),
                    _ => return,
                };
                if let Err(e) = std::process::Command::new("open").arg(&dir).spawn() {
                    tracing::warn!(error = %e, dir = %dir.display(), "打开目录失败");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            cancel_scan,
            video_support,
            app_info,
            query_photos,
            get_facets,
            get_photo,
            ensure_preview,
            reveal_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
