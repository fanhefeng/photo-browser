//! Tauri 应用入口：状态、窗口、命令注册、自定义媒体协议、"打开方式"事件。
//! 扫描编排在 scan.rs、原生菜单在 menu.rs、查看器命令在 viewer.rs。

mod cache;
mod db;
mod logging;
mod media;
mod menu;
mod scan;
mod viewer;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, State, TitleBarStyle, WebviewUrl,
    WebviewWindowBuilder,
};

use db::{Facets, Filter};
use media::MediaItem;
use scan::has_media_ext;

/// 全局状态。
/// - `db`：用于查询的共享连接（扫描走独立连接，靠 SQLite WAL 并发读写）；
///   Arc 包一层，让 async 命令能把连接 clone 进 spawn_blocking 闭包。
/// - `scanning`：是否有扫描在进行，用于拒绝并发扫描。
/// - `cancel`：取消标志，扫描循环会检查它（Arc 以便安全地共享进 rayon 线程）。
/// - `locale`：当前界面语言（zh/en），用于菜单重建去重。
struct AppState {
    db: Arc<Mutex<rusqlite::Connection>>,
    scanning: AtomicBool,
    cancel: Arc<AtomicBool>,
    locale: Mutex<String>,
}

/// 取数据库连接锁，容忍中毒——中毒不代表 Connection 数据损坏，
/// 避免一次 panic 永久瘫痪所有查询。
fn lock_db(db: &Mutex<rusqlite::Connection>) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
    db.lock().unwrap_or_else(|e| e.into_inner())
}

/// 错误是否为瞬时故障（并发持锁，稍后重试即自愈）。
/// 只有瞬时错误才原样上抛：另一实例的扫描事务持锁导致的 SQLITE_BUSY
/// 若误判成损坏走"改名重建"，会把健康的索引整个丢掉。
/// 其余错误（损坏、坏掉的 -wal/-shm 伴生文件、legacy schema 迁移失败等）
/// 一律视为持久性故障：索引是可再生缓存，重建总是安全的——反过来
/// 把持久性故障当瞬时错误上抛，会让应用每次启动都失败且无法自愈。
fn is_transient_db_error(e: &rusqlite::Error) -> bool {
    matches!(
        e.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
    )
}

/// 打开索引库；持久性错误时把旧库挪到 .corrupt 后重建。
/// 索引本质是可再生缓存（重扫即可完全恢复），绝不能让坏掉的库堵死启动；
/// 但瞬时错误必须原样上抛，不能触发重建（见 is_transient_db_error）。
fn open_db_with_recovery() -> Result<rusqlite::Connection, String> {
    match db::open() {
        Ok(conn) => Ok(conn),
        Err(e) if is_transient_db_error(&e) => Err(format!("无法打开数据库: {e}")),
        Err(e) => {
            tracing::warn!(error = %e, "索引库打开失败，备份为 .corrupt 后重建");
            let p = cache::db_path();
            let _ = std::fs::rename(&p, p.with_extension("db.corrupt"));
            // WAL 伴生文件一并清掉，避免新库读到旧日志
            for ext in ["db-wal", "db-shm"] {
                let _ = std::fs::remove_file(p.with_extension(ext));
            }
            db::open().map_err(|e| format!("无法初始化数据库: {e}"))
        }
    }
}

/// 通过"打开方式"进入的待处理文件路径缓冲。
/// 必须用 `Builder::manage` 在 build 阶段注册：macOS 冷启动双击文件时，
/// `RunEvent::Opened` 先于 setup 到达，彼时 `AppState` 尚未注册、缓冲必须已可用。
#[derive(Default)]
struct OpenState {
    pending: Mutex<Vec<String>>,
    /// setup 是否已完成（决定 Opened 事件只缓冲，还是需要建窗/聚焦）
    ready: AtomicBool,
}

fn lock_pending(state: &OpenState) -> std::sync::MutexGuard<'_, Vec<String>> {
    state.pending.lock().unwrap_or_else(|e| e.into_inner())
}

/// 取走并清空待打开文件缓冲。查看器前端在挂载时与收到
/// `viewer-open-pending` 事件时调用（"拉"模型，事件丢失也不丢路径）。
#[tauri::command]
fn take_pending_open(state: State<OpenState>) -> Vec<String> {
    let paths = std::mem::take(&mut *lock_pending(&state));
    if !paths.is_empty() {
        tracing::info!(count = paths.len(), "查看器：取走待打开文件");
    }
    paths
}

/// 把目录动态加入 asset 协议白名单（应对 $HOME / /Volumes 之外的路径）。
/// macOS 的 /tmp、/var 是 /private 下的符号链接，原始路径与 canonicalize 后都要放行。
fn allow_asset_scope(app: &AppHandle, dir: &Path, recursive: bool) {
    let _ = app.asset_protocol_scope().allow_directory(dir, recursive);
    if let Ok(canon) = dir.canonicalize() {
        if canon != dir {
            let _ = app.asset_protocol_scope().allow_directory(&canon, recursive);
        }
    }
}

/// 放行单个文件所在目录（不递归）——"打开方式"的查看器入口用。
fn allow_asset_dir(app: &AppHandle, file: &Path) {
    if let Some(dir) = file.parent() {
        allow_asset_scope(app, dir, false);
    }
}

/// 放行整棵目录树（递归）——扫描根目录用。tauri.conf.json 的静态 scope
/// 只有 $HOME/** 与 /Volumes/**；用户可以选任意目录（如 /Users/Shared），
/// 不放行则 Lightbox 里视频完全无法播放、原图静默降级为预览。
pub(crate) fn allow_asset_tree(app: &AppHandle, dir: &Path) {
    allow_asset_scope(app, dir, true);
}

/// 主浏览器窗口。红绿灯下移对齐工具栏中心；配色全部由前端 CSS 控制。
fn create_main_window<M: Manager<tauri::Wry>>(manager: &M) -> tauri::Result<()> {
    WebviewWindowBuilder::new(manager, "main", WebviewUrl::App("index.html".into()))
        .title("照片浏览器")
        .inner_size(1280.0, 840.0)
        .min_inner_size(880.0, 560.0)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(LogicalPosition::new(20.0, 22.0))
        .build()?;
    Ok(())
}

/// 隐藏 macOS 原生红绿灯（close/miniaturize/zoom）。
/// Quick Look 式查看器用自绘的单色玻璃窗口按钮，但窗口本体仍是原生的
/// （圆角/阴影/拖拽/原生全屏都保留）——红绿灯样式无公开 API 可定制，只能隐藏后仿原生。
#[cfg(target_os = "macos")]
fn hide_native_window_buttons(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    if let Ok(ns) = window.ns_window() {
        let ns = ns as *mut AnyObject;
        unsafe {
            // NSWindowButton: 0 = close, 1 = miniaturize, 2 = zoom
            for kind in 0usize..3 {
                let btn: *mut AnyObject = msg_send![ns, standardWindowButton: kind];
                if !btn.is_null() {
                    let () = msg_send![btn, setHidden: true];
                }
            }
        }
    }
}

/// 独立查看器窗口（"打开方式"进入）。前端按窗口 label 分流渲染 ViewerApp。
/// 深色主题 + 深色底：配合前端的 Liquid Glass 深色视觉，避免启动白闪；
/// 原生红绿灯隐藏，由前端自绘 Quick Look 式关闭/全屏按钮（原生全屏行为不变）。
fn create_viewer_window<M: Manager<tauri::Wry>>(manager: &M) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(manager, "viewer", WebviewUrl::App("index.html".into()))
        .title("")
        .inner_size(1100.0, 760.0)
        .min_inner_size(600.0, 420.0)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(22, 22, 24, 255))
        .build()?;
    #[cfg(target_os = "macos")]
    hide_native_window_buttons(&window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

/// 视频功能是否可用（依赖 ffprobe/ffmpeg）。前端据此提示用户。
/// async + spawn_blocking：探测要同步 spawn ffprobe/ffmpeg 子进程，
/// 启动时在主线程内联跑会卡首帧 UI。
#[tauri::command]
async fn video_support() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let ok = media::has_video_tools();
        tracing::info!(available = ok, "视频工具(ffprobe/ffmpeg)检测");
        ok
    })
    .await
    .map_err(|e| e.to_string())
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

/// 按筛选条件查询媒体列表。
/// async + spawn_blocking：同步命令会在主线程内联执行，大索引上的
/// SQLite 查询（或被扫描写入短暂顶锁）会卡顿 UI；连接 clone Arc 进闭包。
#[tauri::command]
async fn query_photos(
    state: State<'_, AppState>,
    filter: Filter,
) -> Result<Vec<MediaItem>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = lock_db(&db);
        db::query(&conn, &filter).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 分面统计（侧栏计数）。async + spawn_blocking 的理由同 query_photos。
#[tauri::command]
async fn get_facets(state: State<'_, AppState>, root: Option<String>) -> Result<Facets, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = lock_db(&db);
        db::facets(&conn, &root).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 并发预览生成的上限。全分辨率解码单张就要吃满数个核、峰值数百 MB 内存，
/// 快速翻页时不设上限会在 blocking 池（默认 512 线程）里堆出成批并发解码。
/// 3 = 当前图 + 左右预热各一个在途；同 id 去重由前端 api.ts 的在途合并负责。
static PREVIEW_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(3);

/// 懒生成大图预览，返回是否就绪。
/// async + spawn_blocking：全分辨率解码/sips 转码耗时数百毫秒起。
/// 同步命令会在主线程内联执行并冻结整个 UI（窗口拖动/菜单/渲染），
/// 所以本项目凡可能耗时的命令（DB 查询/子进程/目录遍历）都按此模式 async 化。
#[tauri::command]
async fn ensure_preview(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    let item = {
        let conn = lock_db(&state.db);
        db::get_one(&conn, &id).map_err(|e| e.to_string())?
    };
    match item {
        // 视频不生成预览图（前端直接播放原始文件）
        Some(p) if p.kind != "video" => {
            // 限流在 spawn_blocking 之外：排队等待的请求不占用 blocking 线程
            let _permit = PREVIEW_SEMAPHORE.acquire().await.map_err(|e| e.to_string())?;
            tauri::async_runtime::spawn_blocking(move || {
                media::ensure_preview(Path::new(&p.path), &p.id, &p.ext, p.orientation)
            })
            .await
            .map_err(|e| e.to_string())
        }
        _ => Ok(false),
    }
}

/// 在系统默认浏览器中打开外部链接（详情面板的 GPS 地图）。
/// WebView 里 `target="_blank"` 是死的：Tauri 只在应用注册了 `on_new_window`
/// 时才给 wry 装 new_window_req_handler，本应用没注册，于是 WKWebView 的
/// createWebViewWithConfiguration 直接返回 nil——点击毫无反应。只能交给系统。
///
/// scheme 白名单是必需的：`open` 会按 URL 类型调起任意已注册应用（含 file://
/// 与自定义 scheme），放任意字符串进去等于给前端一个任意应用启动器。
/// 校验也保证了 URL 不以 `-` 开头，不会被 `open` 当作命令行选项。
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("backend.badUrl".into());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
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
        // 合法请求恒为 "<blake3 hex>.jpg"：白名单校验文件名本身，从根上杜绝
        // 路径穿越（含 ..、/、子目录），不再依赖 canonicalize 兼任存在性校验。
        let valid = rel.strip_suffix(".jpg").is_some_and(|stem| {
            !stem.is_empty() && stem.bytes().all(|b| b.is_ascii_hexdigit())
        });
        let requested = dir_fn().join(&rel);
        // spawn_blocking 而非裸 thread::spawn：网格快速滚动时 WebView 会一次发出
        // 成百上千个缩略图请求，每请求一个 OS 线程会瞬间堆出同等数量的线程
        // （每个都带 MB 级栈）。tokio 的 blocking 池复用线程并自带上限，超出的排队。
        tauri::async_runtime::spawn_blocking(move || {
            let response = match valid.then(|| std::fs::read(&requested)) {
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
    cache::prune_viewer_cache(30);
    logging::init();
    tracing::info!(env = cache::ENV_NAME, "应用启动");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 应用内更新：检查/下载/安装由前端 UpdateBanner 驱动（@tauri-apps/plugin-updater），
        // 端点与签名公钥见 tauri.conf.json 的 plugins.updater；process 插件提供更新后重启
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(OpenState::default())
        .register_asynchronous_uri_scheme_protocol("thumb", image_protocol(cache::thumbs_dir))
        .register_asynchronous_uri_scheme_protocol("preview", image_protocol(cache::previews_dir))
        .register_asynchronous_uri_scheme_protocol("vpreview", image_protocol(cache::viewer_dir))
        .setup(|app| {
            let conn = open_db_with_recovery()?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                scanning: AtomicBool::new(false),
                cancel: Arc::new(AtomicBool::new(false)),
                locale: Mutex::new("zh".to_string()),
            });

            // dev 模式下文件关联不生效：支持 argv 传媒体文件路径模拟"打开方式"
            // （pnpm tauri dev -- -- /path/to/xx.jpg）
            // args_os + into_string：非 UTF-8 的 argv 直接跳过，std::env::args() 会 panic。
            // canonicalize 让相对路径/符号链接在入口就归一（缓存 id、asset 放行都以此为准）。
            #[cfg(debug_assertions)]
            if let Some(p) = std::env::args_os()
                .skip(1)
                .filter_map(|a| a.into_string().ok())
                .filter_map(|a| Path::new(&a).canonicalize().ok())
                .find(|p| p.is_file() && has_media_ext(p))
            {
                allow_asset_dir(app.handle(), &p);
                lock_pending(&app.state::<OpenState>()).push(p.to_string_lossy().to_string());
            }

            // 双击文件冷启动时 macOS 的 Opened 事件先于 setup 到达（路径已在缓冲）：
            // 只开查看器窗口，不带出主浏览器界面。正常启动则只开主窗口。
            // 窗口均由 Rust 创建（而非 tauri.conf.json），以便定制红绿灯/深色底。
            let has_pending = !lock_pending(&app.state::<OpenState>()).is_empty();
            if has_pending {
                create_viewer_window(app)?;
            } else {
                create_main_window(app)?;
            }
            app.state::<OpenState>().ready.store(true, Ordering::SeqCst);

            // 原生菜单栏：启动先用中文，前端 ready 后通过 set_locale 同步到实际语言。
            let menu = menu::build_menu(app.handle(), "zh")?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| menu::handle_menu_event(app, &event));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan::scan_directory,
            scan::cancel_scan,
            video_support,
            app_info,
            query_photos,
            get_facets,
            ensure_preview,
            reveal_in_finder,
            open_external,
            menu::set_locale,
            take_pending_open,
            viewer::list_siblings,
            viewer::viewer_item,
            viewer::viewer_preview,
            viewer::viewer_trash,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS "打开方式"/拖到 Dock 图标：冷启动时先于 setup 到达，只入缓冲；
            // 热运行时聚焦（或创建）查看器窗口并通知前端拉取。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    // 入口即 canonicalize：/tmp → /private/tmp 等拼写在此归一
                    // （扫描 root 在 scan_impl 同样归一）。此后缓存 id / asset 放行 /
                    // 索引清理都以规范拼写为准；viewer_trash 的双拼写清理仅为
                    // 归一化之前建立的旧索引兜底，不可当作冗余删除。
                    .map(|p| p.canonicalize().unwrap_or(p))
                    .filter(|p| has_media_ext(p))
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                if paths.is_empty() {
                    return;
                }
                for p in &paths {
                    allow_asset_dir(app, Path::new(p));
                }
                let open_state = app.state::<OpenState>();
                lock_pending(&open_state).extend(paths);
                if open_state.ready.load(Ordering::SeqCst) {
                    if let Some(w) = app.get_webview_window("viewer") {
                        let _ = app.emit_to("viewer", "viewer-open-pending", ());
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    } else if let Err(e) = create_viewer_window(app) {
                        tracing::error!(error = %e, "创建查看器窗口失败");
                    }
                }
            }
        });
}
