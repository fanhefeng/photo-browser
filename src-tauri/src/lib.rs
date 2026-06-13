//! Tauri 应用入口：状态管理、命令、自定义图片协议、目录扫描。

mod cache;
mod db;
mod media;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use rayon::prelude::*;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use db::{Facets, Filter};
use media::Photo;

/// 全局状态：一个用于查询的共享数据库连接。
/// 扫描走独立连接（见 scan_impl），靠 SQLite WAL 实现并发读写。
struct AppState {
    db: Mutex<rusqlite::Connection>,
}

fn has_photo_ext(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| media::is_media_ext(&e.to_lowercase()))
        .unwrap_or(false)
}

/// 扫描一个目录：增量解析 EXIF、生成缩略图、写入索引，过程中发送进度事件。
#[tauri::command]
async fn scan_directory(app: AppHandle, path: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || scan_impl(app, path))
        .await
        .map_err(|e| e.to_string())?
}

fn scan_impl(app: AppHandle, root: String) -> Result<usize, String> {
    let mut conn = db::open().map_err(|e| e.to_string())?;

    // 1. 收集目录下所有照片文件
    let files: Vec<PathBuf> = WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| has_photo_ext(p))
        .collect();

    // 2. 增量：跳过 mtime 未变的文件（仅看当前 root 目录下的已有记录）
    let existing = db::existing_mtimes(&conn, &root).unwrap_or_default();
    let to_process: Vec<PathBuf> = files
        .iter()
        .filter(|p| {
            let id = media::photo_id(p);
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
    let _ = app.emit("scan-progress", json!({ "done": 0, "total": total }));

    // 3. 并行解析 + 生成缩略图（rayon），实时上报进度
    let counter = AtomicUsize::new(0);
    let photos: Vec<Photo> = to_process
        .par_iter()
        .filter_map(|p| {
            let result = media::build_photo(p);
            let n = counter.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 16 == 0 || n == total {
                let _ = app.emit("scan-progress", json!({ "done": n, "total": total }));
            }
            result
        })
        .collect();

    // 4. 写入索引
    db::upsert_photos(&mut conn, &photos).map_err(|e| e.to_string())?;

    // 5. 清理已删除的文件：`existing` 已限定在当前 root 下，因此这里只会
    //    删除“本目录中确实消失了”的文件，不会误伤其他目录的索引。
    let current_ids: HashSet<String> = files.iter().map(|p| media::photo_id(p)).collect();
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

    let _ = app.emit("scan-done", json!({ "processed": photos.len(), "total_files": files.len() }));
    Ok(photos.len())
}

#[tauri::command]
fn query_photos(state: State<AppState>, filter: Filter) -> Result<Vec<Photo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::query(&conn, &filter).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_facets(state: State<AppState>, root: Option<String>) -> Result<Facets, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::facets(&conn, &root).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_photo(state: State<AppState>, id: String) -> Result<Option<Photo>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::get_one(&conn, &id).map_err(|e| e.to_string())
}

/// 懒生成大图预览，返回是否就绪。
#[tauri::command]
fn ensure_preview(state: State<AppState>, id: String) -> Result<bool, String> {
    let photo = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_one(&conn, &id).map_err(|e| e.to_string())?
    };
    match photo {
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

/// 在系统文件管理器（Finder）中显示该照片
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
        let rel = request
            .uri()
            .path()
            .trim_start_matches('/')
            .to_string();
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
                    .unwrap(),
                _ => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            };
            responder.respond(response);
        });
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("thumb", image_protocol(cache::thumbs_dir))
        .register_asynchronous_uri_scheme_protocol("preview", image_protocol(cache::previews_dir))
        .setup(|app| {
            let conn = db::open().expect("无法初始化数据库");
            app.manage(AppState {
                db: Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            query_photos,
            get_facets,
            get_photo,
            ensure_preview,
            reveal_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
