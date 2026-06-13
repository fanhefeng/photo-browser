// 展示用的格式化辅助

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(unixSec: number | null): string {
  if (!unixSec) return "未知时间";
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours()
  )}:${p(d.getUTCMinutes())}`;
}

export function formatDateShort(unixSec: number | null): string {
  if (!unixSec) return "未知";
  const d = new Date(unixSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

// WebView 可直接解码的图片格式——这些直接加载原图，呈现原始清晰度。
// 仅列入 PHOTO_EXTS 中确实会被扫描的格式。
const WEB_DISPLAYABLE = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"]);

export function isWebDisplayable(ext: string): boolean {
  return WEB_DISPLAYABLE.has(ext.toLowerCase());
}

export function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return "";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

export function formatExposure(p: {
  aperture: number | null;
  shutter: string | null;
  iso: number | null;
  focal_length: number | null;
}): string {
  const parts: string[] = [];
  if (p.focal_length) parts.push(`${Math.round(p.focal_length)}mm`);
  if (p.aperture) parts.push(`f/${p.aperture}`);
  if (p.shutter) parts.push(p.shutter);
  if (p.iso) parts.push(`ISO ${p.iso}`);
  return parts.join(" · ");
}
