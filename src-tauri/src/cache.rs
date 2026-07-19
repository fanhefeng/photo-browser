//! 应用目录与文件路径的统一管理（按数据类型分目录、按环境/系统隔离）。
//!
//! 按用途使用不同的系统目录，遵循各平台规范：
//! - **缓存**（缩略图/预览图，可再生）→ `dirs::cache_dir()`
//! - **数据**（SQLite 索引，不应被系统清理）→ `dirs::data_local_dir()`
//! - **日志**（诊断记录）→ macOS `~/Library/Logs`，其余放数据目录下的 `logs/`
//!
//! dev 与 prod 使用不同的目录名（`-dev` 后缀），互不干扰。
//!
//! 路径访问器只负责**拼接路径**，不产生副作用；目录在启动时由 [`ensure_dirs`] 统一创建。

use std::fs;
use std::path::PathBuf;

/// 当前运行环境名（dev / prod）
pub const ENV_NAME: &str = if cfg!(debug_assertions) { "dev" } else { "prod" };

/// 预览缓存版本。预览分辨率/算法变化时 +1，启动时会清空旧预览。
/// 1 = 1920px（旧），2 = 3840px（当前）。
const PREVIEW_VERSION: &str = "2";

/// 应用目录名，按环境加后缀
fn app_dir_name() -> &'static str {
    if cfg!(debug_assertions) {
        "com.fhf.photo-browser-dev"
    } else {
        "com.fhf.photo-browser"
    }
}

/// 缓存根目录（可再生数据：缩略图/预览图）。例：macOS `~/Library/Caches/<app>`
pub fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(app_dir_name())
}

/// 数据根目录（不应被系统清理：SQLite 索引）。例：macOS `~/Library/Application Support/<app>`
pub fn data_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(app_dir_name())
}

/// 日志根目录。macOS 用 `~/Library/Logs/<app>`，其余平台放数据目录下的 `logs/`。
pub fn logs_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Library/Logs")
        .join(app_dir_name());
    #[cfg(not(target_os = "macos"))]
    let base = data_dir().join("logs");
    base
}

/// SQLite 索引文件路径（数据目录）
pub fn db_path() -> PathBuf {
    data_dir().join("index.db")
}

/// 缩略图缓存目录（网格用，约 320px）
pub fn thumbs_dir() -> PathBuf {
    cache_dir().join("thumbs")
}

/// 预览图缓存目录（大图查看用，按需懒生成）
pub fn previews_dir() -> PathBuf {
    cache_dir().join("previews")
}

/// 查看器全分辨率转码缓存目录（HEIC 等 WebView 无法解码时的 sips 兜底产物）。
/// 与 previews/ 隔离：previews 的语义是"最长边 3840"，且会被扫描/版本迁移随时清掉。
pub fn viewer_dir() -> PathBuf {
    cache_dir().join("viewer")
}

pub fn thumb_file(id: &str) -> PathBuf {
    thumbs_dir().join(format!("{id}.jpg"))
}

pub fn preview_file(id: &str) -> PathBuf {
    previews_dir().join(format!("{id}.jpg"))
}

pub fn viewer_file(id: &str) -> PathBuf {
    viewer_dir().join(format!("{id}.jpg"))
}

/// 清理过期的查看器缓存（全分辨率 JPEG 体积大，按修改时间淘汰防止无限膨胀；
/// 命中缓存不刷新 mtime，常用文件到期后会被清掉再按需重转，代价可接受）。
pub fn prune_viewer_cache(max_age_days: u64) {
    let cutoff = std::time::SystemTime::now()
        - std::time::Duration::from_secs(max_age_days * 24 * 3600);
    if let Ok(entries) = fs::read_dir(viewer_dir()) {
        for entry in entries.flatten() {
            let stale = entry
                .metadata()
                .and_then(|m| m.modified())
                .map(|t| t < cutoff)
                .unwrap_or(false);
            if stale {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// 启动时创建全部目录。之后访问器只拼路径，不再产生 I/O 副作用。
pub fn ensure_dirs() {
    for dir in [
        data_dir(),
        cache_dir(),
        thumbs_dir(),
        previews_dir(),
        viewer_dir(),
        logs_dir(),
    ] {
        let _ = fs::create_dir_all(&dir);
    }
}

/// 预览缓存版本迁移：版本变化时清空旧预览（如分辨率升级 1920→3840），
/// 避免大图复用过期的低清预览。一次性操作，开销极小。
pub fn migrate_previews() {
    let dir = previews_dir();
    let marker = dir.join(".cache_version");
    let current = fs::read_to_string(&marker).unwrap_or_default();
    if current.trim() != PREVIEW_VERSION {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
        let _ = fs::write(&marker, PREVIEW_VERSION);
    }
}
