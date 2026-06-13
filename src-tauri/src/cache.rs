//! 缓存目录与文件路径的统一管理。
//!
//! 所有派生数据（SQLite 索引、缩略图、预览图）都放在系统缓存目录下，
//! 这样既不污染用户的照片目录，也方便整体清理。

use std::fs;
use std::path::PathBuf;

/// 应用缓存根目录，例如 macOS 下 ~/Library/Caches/com.fhf.photo-browser
pub fn base_dir() -> PathBuf {
    let dir = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("com.fhf.photo-browser");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// SQLite 索引文件路径
pub fn db_path() -> PathBuf {
    base_dir().join("index.db")
}

/// 缩略图缓存目录（网格用，约 320px）
pub fn thumbs_dir() -> PathBuf {
    let dir = base_dir().join("thumbs");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 预览图缓存目录（大图查看用，约 1920px，按需懒生成）
pub fn previews_dir() -> PathBuf {
    let dir = base_dir().join("previews");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub fn thumb_file(id: &str) -> PathBuf {
    thumbs_dir().join(format!("{id}.jpg"))
}

pub fn preview_file(id: &str) -> PathBuf {
    previews_dir().join(format!("{id}.jpg"))
}
