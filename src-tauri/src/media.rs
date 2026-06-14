//! 单个媒体文件（照片或视频）的处理：解析元数据、读取尺寸、生成缩略图/封面/预览图。
//!
//! 这一层完全不碰数据库，纯函数式地把"一个文件路径"变成"一条结构化记录"，
//! 因此可以被 rayon 安全地并行调用。照片走 EXIF + image/sips，视频走 ffprobe + ffmpeg。

use std::path::Path;
use std::process::Command;

use chrono::NaiveDateTime;
use exif::{In, Tag, Value};
use serde::Serialize;

/// 我们识别为"照片"的扩展名（小写）
pub const PHOTO_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "avif",
];

/// 我们识别为"视频"的扩展名（小写）
pub const VIDEO_EXTS: &[&str] = &[
    "mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv", "3gp", "mpg", "mpeg", "mts", "m2ts",
];

/// 是否为受支持的媒体文件（照片或视频）
pub fn is_media_ext(ext: &str) -> bool {
    PHOTO_EXTS.contains(&ext) || VIDEO_EXTS.contains(&ext)
}

/// 视频元数据/封面所需的外部工具（ffprobe + ffmpeg）是否就绪。
pub fn has_video_tools() -> bool {
    tool_ok("ffprobe") && tool_ok("ffmpeg")
}

fn tool_ok(name: &str) -> bool {
    Command::new(name)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// 运行外部命令并限制最长执行时间；超时则 kill 子进程并返回 Err。
/// 防止损坏/畸形媒体文件让 ffmpeg/ffprobe/sips 挂起，逐步耗尽 rayon 线程池。
fn run_timeout(mut cmd: Command, secs: u64) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::Duration;
    use wait_timeout::ChildExt;

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    match child
        .wait_timeout(Duration::from_secs(secs))
        .map_err(|e| e.to_string())?
    {
        Some(status) => {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut o) = child.stdout.take() {
                let _ = o.read_to_end(&mut stdout);
            }
            if let Some(mut e) = child.stderr.take() {
                let _ = e.read_to_end(&mut stderr);
            }
            Ok(std::process::Output { status, stdout, stderr })
        }
        None => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("外部命令超时（>{secs}s）"))
        }
    }
}

/// macOS 上 image crate 无法直接解码、需要走 sips 兜底的格式
fn needs_sips(ext: &str) -> bool {
    matches!(ext, "heic" | "heif" | "avif")
}

/// 一条完整的媒体记录（照片或视频），序列化后直接发给前端。
#[derive(Serialize, Clone, Debug, Default)]
pub struct MediaItem {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub dir: String,
    pub ext: String,
    /// "photo" | "video"
    pub kind: String,
    pub file_size: i64,
    pub mtime: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    /// 视频时长，秒
    pub duration: Option<f64>,
    /// 拍摄时间，Unix 秒
    pub taken_at: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    /// 光圈 f 值
    pub aperture: Option<f64>,
    /// 快门，如 "1/200"
    pub shutter: Option<String>,
    pub focal_length: Option<f64>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub orientation: Option<i64>,
}

/// 稳定的媒体 id：绝对路径的 blake3 哈希。
/// 同一文件多次扫描得到相同 id，从而支持增量更新与缩略图复用。
pub fn media_id(path: &Path) -> String {
    blake3::hash(path.to_string_lossy().as_bytes())
        .to_hex()
        .to_string()
}

/// 处理单个文件：解析元数据并生成缩略图。失败返回 None（跳过该文件）。
pub fn build_media(path: &Path) -> Option<MediaItem> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !is_media_ext(&ext) {
        return None;
    }

    let id = media_id(path);
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let is_video = VIDEO_EXTS.contains(&ext.as_str());
    let mut photo = MediaItem {
        id: id.clone(),
        path: path.to_string_lossy().to_string(),
        filename: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        dir: path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        ext: ext.clone(),
        kind: if is_video { "video".into() } else { "photo".into() },
        file_size: meta.len() as i64,
        mtime,
        ..Default::default()
    };

    let thumb_dst = crate::cache::thumb_file(&id);
    if is_video {
        parse_video_meta(path, &mut photo);
        // 抽一帧做封面（复用 thumb:// 机制）
        if let Err(e) = video_poster(path, &thumb_dst, 320) {
            tracing::warn!(path = %path.display(), error = %e, "视频封面生成失败");
        }
    } else {
        parse_exif(path, &mut photo);

        // 尺寸：EXIF 没给的话用 image 读文件头（很轻量）
        if photo.width.is_none() {
            if let Ok((w, h)) = image::image_dimensions(path) {
                photo.width = Some(w as i64);
                photo.height = Some(h as i64);
            }
        }
        // 旋转 90/270 的照片：存储宽高需交换，才能与可视方向（及缩略图）一致
        if matches!(photo.orientation, Some(5) | Some(6) | Some(7) | Some(8)) {
            std::mem::swap(&mut photo.width, &mut photo.height);
        }
        // (重新)生成缩略图。build_media 只对新增/变更的文件调用，因此总是重建，
        // 避免文件被原地替换后仍显示旧缩略图。
        if let Err(e) = make_resized(path, &thumb_dst, 320, &ext, photo.orientation) {
            tracing::warn!(path = %path.display(), error = %e, "缩略图生成失败");
        }
    }

    // 失效旧预览图，下次打开大图时按新内容懒生成
    let _ = std::fs::remove_file(crate::cache::preview_file(&id));

    Some(photo)
}

/// 用 ffprobe 读取视频元数据（时长/分辨率/拍摄时间/机型/GPS）。
fn parse_video_meta(path: &Path, photo: &mut MediaItem) {
    let mut cmd = Command::new("ffprobe");
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
    ])
    .arg(path);
    let out = match run_timeout(cmd, 30) {
        Ok(o) if o.status.success() => o.stdout,
        _ => {
            tracing::warn!(path = %path.display(), "ffprobe 读取视频元数据失败");
            return;
        }
    };
    let json: serde_json::Value = match serde_json::from_slice(&out) {
        Ok(v) => v,
        Err(_) => return,
    };

    // 找到第一条视频流，取宽高与旋转
    let mut rotation = 0i64;
    if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
        if let Some(vs) = streams
            .iter()
            .find(|s| s.get("codec_type").and_then(|c| c.as_str()) == Some("video"))
        {
            photo.width = vs.get("width").and_then(|v| v.as_i64()).or(photo.width);
            photo.height = vs.get("height").and_then(|v| v.as_i64()).or(photo.height);
            // 旋转可能在 tags.rotate 或 side_data_list 的 displaymatrix
            if let Some(r) = vs
                .get("tags")
                .and_then(|t| t.get("rotate"))
                .and_then(|r| r.as_str())
                .and_then(|r| r.parse::<i64>().ok())
            {
                rotation = r;
            }
        }
    }

    let format = json.get("format");
    // 时长
    photo.duration = format
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok());

    // 竖拍视频（旋转 90/270）：交换宽高以匹配实际显示方向
    if rotation.abs() % 180 == 90 {
        std::mem::swap(&mut photo.width, &mut photo.height);
    }

    if let Some(tags) = format.and_then(|f| f.get("tags")) {
        // 拍摄时间：creation_time 形如 2023-08-15T10:30:00.000000Z
        photo.taken_at = tags
            .get("creation_time")
            .and_then(|t| t.as_str())
            .and_then(parse_iso8601);
        // 机型（Apple 视频常带 com.apple.quicktime.make/model）
        photo.camera_make = tags
            .get("com.apple.quicktime.make")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        photo.camera_model = tags
            .get("com.apple.quicktime.model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        // GPS：ISO6709 形如 +37.7858-122.4064+010.000/
        if let Some((lat, lon)) = tags
            .get("com.apple.quicktime.location.ISO6709")
            .or_else(|| tags.get("location"))
            .and_then(|v| v.as_str())
            .and_then(parse_iso6709)
        {
            photo.gps_lat = Some(lat);
            photo.gps_lon = Some(lon);
        }
    }
}

/// 用 ffmpeg 抽取一帧作为视频封面（缩放到最长边 max，存为 JPEG）。
fn video_poster(src: &Path, dst: &Path, max: u32) -> Result<(), String> {
    // 取靠前但避开纯黑首帧的位置
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-v", "quiet", "-y", "-ss", "1"])
        .arg("-i")
        .arg(src)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &format!("scale='min({max},iw)':-2"),
            "-q:v",
            "4",
        ])
        .arg(dst);
    let out = run_timeout(cmd, 30)?;
    if out.status.success() && dst.exists() {
        return Ok(());
    }
    // 视频太短（不足 1 秒）时回退到第 0 帧
    let mut cmd2 = Command::new("ffmpeg");
    cmd2.args(["-v", "quiet", "-y", "-i"])
        .arg(src)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &format!("scale='min({max},iw)':-2"),
            "-q:v",
            "4",
        ])
        .arg(dst);
    let out2 = run_timeout(cmd2, 30)?;
    if out2.status.success() && dst.exists() {
        Ok(())
    } else {
        Err("ffmpeg 抽帧失败".into())
    }
}

/// 解析 ISO8601 时间字符串为 Unix 秒
fn parse_iso8601(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp())
        .or_else(|| {
            NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), "%Y-%m-%dT%H:%M:%S%.f")
                .ok()
                .map(|dt| dt.and_utc().timestamp())
        })
}

/// 解析 ISO6709 坐标串（如 "+37.7858-122.4064+010.000/"）为 (lat, lon)
fn parse_iso6709(s: &str) -> Option<(f64, f64)> {
    let s = s.trim();
    // 找到第二个符号位置切分纬度/经度
    let bytes = s.as_bytes();
    let mut split = None;
    for (i, &b) in bytes.iter().enumerate().skip(1) {
        if b == b'+' || b == b'-' {
            split = Some(i);
            break;
        }
    }
    let split = split?;
    let lat: f64 = s[..split].parse().ok()?;
    let rest = &s[split..];
    // 经度到下一个符号或 '/' 结束
    let lon_end = rest[1..]
        .find(|c| c == '+' || c == '-' || c == '/')
        .map(|i| i + 1)
        .unwrap_or(rest.len());
    let lon: f64 = rest[..lon_end].parse().ok()?;
    Some((lat, lon))
}

/// 懒生成大图预览（打开大图时调用），返回是否成功。
pub fn ensure_preview(path: &Path, id: &str, ext: &str, orientation: Option<i64>) -> bool {
    let dst = crate::cache::preview_file(id);
    if dst.exists() {
        return true;
    }
    // 较高分辨率，让 HEIC/TIFF 等不可直接显示的格式也接近原图清晰度
    make_resized(path, &dst, 3840, ext, orientation).is_ok()
}

/// 把源图缩放到最长边 `max` 像素并保存为 JPEG。
/// 标准格式走 image crate；HEIC/HEIF/AVIF 走 macOS 自带的 sips。
fn make_resized(
    src: &Path,
    dst: &Path,
    max: u32,
    ext: &str,
    orientation: Option<i64>,
) -> Result<(), String> {
    if needs_sips(ext) {
        return sips_resize(src, dst, max);
    }
    match image::open(src) {
        Ok(img) => {
            let resized = img.thumbnail(max, max);
            let rotated = apply_orientation(resized, orientation.unwrap_or(1));
            flatten_to_rgb(&rotated)
                .save(dst)
                .map_err(|e| format!("保存缩略图失败: {e}"))
        }
        // image 解码失败时也尝试 sips（覆盖个别异常编码）
        Err(_) => sips_resize(src, dst, max),
    }
}

/// 转为 RGB 以便存成 JPEG。带透明通道的图先合成到白色背景，
/// 否则 to_rgb8 直接丢弃 alpha 会让透明区域露出底色（常为黑）。
fn flatten_to_rgb(img: &image::DynamicImage) -> image::RgbImage {
    if img.color().has_alpha() {
        let rgba = img.to_rgba8();
        let mut bg =
            image::RgbImage::from_pixel(rgba.width(), rgba.height(), image::Rgb([255, 255, 255]));
        for (x, y, px) in rgba.enumerate_pixels() {
            let a = px[3] as f32 / 255.0;
            let out = bg.get_pixel_mut(x, y);
            for i in 0..3 {
                out[i] = (px[i] as f32 * a + out[i] as f32 * (1.0 - a)).round() as u8;
            }
        }
        bg
    } else {
        img.to_rgb8()
    }
}

/// 调用 macOS 的 sips 生成缩略图（自动处理 HEIC、自动按 EXIF 旋转）
fn sips_resize(src: &Path, dst: &Path, max: u32) -> Result<(), String> {
    let mut cmd = Command::new("sips");
    cmd.args(["-s", "format", "jpeg", "-Z", &max.to_string()])
        .arg(src)
        .arg("--out")
        .arg(dst);
    let out = run_timeout(cmd, 30)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).to_string())
    }
}

/// 根据 EXIF orientation 旋转/翻转图像（image crate 不会自动处理）
fn apply_orientation(img: image::DynamicImage, orientation: i64) -> image::DynamicImage {
    use image::imageops::{flip_horizontal, flip_vertical, rotate180, rotate270, rotate90};
    match orientation {
        2 => flip_horizontal(&img).into(),
        3 => rotate180(&img).into(),
        4 => flip_vertical(&img).into(),
        5 => rotate90(&flip_horizontal(&img)).into(),
        6 => rotate90(&img).into(),
        7 => rotate270(&flip_horizontal(&img)).into(),
        8 => rotate270(&img).into(),
        _ => img,
    }
}

/// 解析 EXIF，把能拿到的字段填进 photo。读不到 EXIF 不算错误（很多 PNG 就没有）。
fn parse_exif(path: &Path, photo: &mut MediaItem) {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut reader = std::io::BufReader::new(&file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(e) => e,
        Err(_) => return,
    };

    // 尺寸
    photo.width = get_u32(&exif, Tag::PixelXDimension).map(|v| v as i64).or(photo.width);
    photo.height = get_u32(&exif, Tag::PixelYDimension).map(|v| v as i64).or(photo.height);

    // 方向
    photo.orientation = get_u32(&exif, Tag::Orientation).map(|v| v as i64);

    // 相机 / 镜头
    photo.camera_make = get_ascii(&exif, Tag::Make);
    photo.camera_model = get_ascii(&exif, Tag::Model);
    photo.lens = get_ascii(&exif, Tag::LensModel);

    // 拍摄参数
    photo.iso = get_u32(&exif, Tag::PhotographicSensitivity).map(|v| v as i64);
    photo.aperture = get_rational_f64(&exif, Tag::FNumber);
    photo.focal_length = get_rational_f64(&exif, Tag::FocalLength);
    photo.shutter = get_shutter(&exif);

    // 拍摄时间
    photo.taken_at = get_datetime(&exif);

    // GPS
    if let (Some(lat), Some(lon)) = (
        get_gps(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef, &['S']),
        get_gps(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef, &['W']),
    ) {
        photo.gps_lat = Some(lat);
        photo.gps_lon = Some(lon);
    }
}

fn get_ascii(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    let s = field.display_value().to_string();
    let s = s.trim().trim_matches('"').trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn get_u32(exif: &exif::Exif, tag: Tag) -> Option<u32> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    field.value.get_uint(0)
}

fn get_rational_f64(exif: &exif::Exif, tag: Tag) -> Option<f64> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match &field.value {
        Value::Rational(v) if !v.is_empty() => Some(v[0].to_f64()),
        Value::SRational(v) if !v.is_empty() => Some(v[0].to_f64()),
        _ => None,
    }
}

/// 快门速度：ExposureTime 是一个有理数，格式化为 "1/200" 或 "2s"
fn get_shutter(exif: &exif::Exif) -> Option<String> {
    let field = exif.get_field(Tag::ExposureTime, In::PRIMARY)?;
    if let Value::Rational(v) = &field.value {
        if let Some(r) = v.first() {
            if r.num == 0 {
                return None;
            }
            let secs = r.to_f64();
            return Some(if secs < 1.0 {
                format!("1/{}", (1.0 / secs).round() as i64)
            } else {
                format!("{secs}s")
            });
        }
    }
    None
}

/// 优先 DateTimeOriginal，其次 DateTime；格式 "YYYY:MM:DD HH:MM:SS"
fn get_datetime(exif: &exif::Exif) -> Option<i64> {
    for tag in [Tag::DateTimeOriginal, Tag::DateTime] {
        if let Some(field) = exif.get_field(tag, In::PRIMARY) {
            let s = field.display_value().to_string();
            if let Ok(dt) = NaiveDateTime::parse_from_str(s.trim(), "%Y-%m-%d %H:%M:%S")
                .or_else(|_| NaiveDateTime::parse_from_str(s.trim(), "%Y:%m:%d %H:%M:%S"))
            {
                return Some(dt.and_utc().timestamp());
            }
        }
    }
    None
}

/// 把 GPS 的 度/分/秒 三元有理数转成十进制度数，按方位决定正负。
fn get_gps(exif: &exif::Exif, coord: Tag, refr: Tag, negative_refs: &[char]) -> Option<f64> {
    let field = exif.get_field(coord, In::PRIMARY)?;
    let dms = match &field.value {
        Value::Rational(v) if v.len() >= 3 => v,
        _ => return None,
    };
    let deg = dms[0].to_f64() + dms[1].to_f64() / 60.0 + dms[2].to_f64() / 3600.0;
    let sign = exif
        .get_field(refr, In::PRIMARY)
        .map(|f| f.display_value().to_string())
        .map(|s| {
            if s.chars().next().map(|c| negative_refs.contains(&c)).unwrap_or(false) {
                -1.0
            } else {
                1.0
            }
        })
        .unwrap_or(1.0);
    Some(deg * sign)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso6709_basic() {
        let (lat, lon) = parse_iso6709("+37.7858-122.4064+010.000/").unwrap();
        assert!((lat - 37.7858).abs() < 1e-6);
        assert!((lon + 122.4064).abs() < 1e-6);
    }

    #[test]
    fn iso6709_southern_eastern() {
        let (lat, lon) = parse_iso6709("-33.8688+151.2093/").unwrap();
        assert!((lat + 33.8688).abs() < 1e-6);
        assert!((lon - 151.2093).abs() < 1e-6);
    }

    #[test]
    fn iso8601_variants() {
        assert!(parse_iso8601("2023-08-15T10:30:00.000000Z").is_some());
        assert!(parse_iso8601("2023-08-15T10:30:00Z").is_some());
        // RFC3339 带时区
        assert!(parse_iso8601("2023-08-15T10:30:00+08:00").is_some());
        assert!(parse_iso8601("not-a-date").is_none());
    }

    #[test]
    fn media_ext_classification() {
        assert!(is_media_ext("jpg"));
        assert!(is_media_ext("mp4"));
        assert!(!is_media_ext("txt"));
        assert!(VIDEO_EXTS.contains(&"mov"));
    }
}
