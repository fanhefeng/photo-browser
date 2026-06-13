import { useEffect, useState } from "react";
import type { Photo } from "../types";
import {
  ensurePreview,
  originalSrc,
  previewUrl,
  revealInFinder,
  thumbUrl,
  videoSrc,
} from "../api";
import {
  formatDate,
  formatDuration,
  formatExposure,
  formatSize,
  isWebDisplayable,
} from "../utils";
import { useZoom } from "../hooks/useZoom";

interface Props {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function Lightbox({ photos, index, onClose, onNavigate }: Props) {
  const photo = photos[index];
  const isVideo = photo.kind === "video";

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && index < photos.length - 1) onNavigate(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onNavigate]);

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            className="lightbox__nav lightbox__nav--prev"
            onClick={() => onNavigate(index - 1)}
            aria-label="上一张"
          >
            ‹
          </button>
        )}

        {isVideo ? (
          <VideoStage photo={photo} />
        ) : (
          <PhotoStage photo={photo} neighbors={[photos[index - 1], photos[index + 1]]} />
        )}

        {index < photos.length - 1 && (
          <button
            className="lightbox__nav lightbox__nav--next"
            onClick={() => onNavigate(index + 1)}
            aria-label="下一张"
          >
            ›
          </button>
        )}
      </div>

      <DetailPanel photo={photo} onClose={onClose} />
    </div>
  );
}

/** 视频播放（asset 协议，支持拖动进度） */
function VideoStage({ photo }: { photo: Photo }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="media-error" onClick={(e) => e.stopPropagation()}>
        无法播放该视频<br />
        <span className="media-error__sub">可能是编码不受 WebView 支持（如部分 MOV/HEVC）</span>
      </div>
    );
  }
  return (
    <video
      key={photo.id}
      className="lightbox__video"
      src={videoSrc(photo.path)}
      controls
      autoPlay
      preload="auto"
      onError={() => setFailed(true)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** 照片查看：缩放 + 平移（逻辑封装在 useZoom） */
function PhotoStage({ photo, neighbors }: { photo: Photo; neighbors: (Photo | undefined)[] }) {
  // 当前显示的图源：先缩略图占位，高清图后台预解码完成后再整体替换
  const [src, setSrc] = useState(() => thumbUrl(photo.id));
  const { zoom, stageRef, setScale, reset, bind } = useZoom(photo.id);

  useEffect(() => {
    setSrc(thumbUrl(photo.id));
    let alive = true;
    // 预解码完成后再替换，避免半路糊图闪烁；失败时可走回退
    const swapWhenLoaded = (url: string, onFail?: () => void) => {
      const img = new Image();
      img.onload = () => alive && setSrc(url);
      img.onerror = () => alive && onFail?.();
      img.src = url;
    };
    // 回退/兜底：生成并加载预览图（preview:// 对任意路径都可用）
    const loadPreview = () =>
      ensurePreview(photo.id)
        .then((ok) => ok && swapWhenLoaded(previewUrl(photo.id)))
        .catch(() => {});

    if (isWebDisplayable(photo.ext)) {
      // 浏览器可解码：直接上原图（原始清晰度）；若原图加载失败
      //（如路径不在 asset scope 内），回退到预览图，避免永久停留在模糊缩略图。
      swapWhenLoaded(originalSrc(photo.path), loadPreview);
    } else {
      // HEIC/TIFF 等：用高分辨率预览图
      loadPreview();
    }
    // 预热相邻的非原生格式预览
    neighbors.forEach((n) => {
      if (n && n.kind === "photo" && !isWebDisplayable(n.ext)) ensurePreview(n.id).catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [photo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={stageRef} className="zoom-stage" onClick={(e) => e.stopPropagation()} {...bind}>
      <img
        className="lightbox__img"
        src={src}
        alt={photo.filename}
        draggable={false}
        style={{
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          transition: zoom.scale === 1 ? "transform 0.12s ease-out" : "none",
        }}
      />

      <div
        className="zoom-bar"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="zoom-bar__btn" onClick={() => setScale(1 / 1.4)} aria-label="缩小">
          −
        </button>
        <span className="zoom-bar__pct">{Math.round(zoom.scale * 100)}%</span>
        <button className="zoom-bar__btn" onClick={() => setScale(1.4)} aria-label="放大">
          +
        </button>
        <button className="zoom-bar__btn" onClick={reset} aria-label="适应屏幕">
          ⤢
        </button>
      </div>
    </div>
  );
}

function DetailPanel({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const isVideo = photo.kind === "video";
  const dims = photo.width && photo.height ? `${photo.width} × ${photo.height}` : "—";
  const subtitle = isVideo
    ? [formatDuration(photo.duration), dims !== "—" ? dims : ""].filter(Boolean).join(" · ") ||
      "视频"
    : formatExposure(photo) || "无拍摄参数";

  const gps =
    photo.gps_lat != null && photo.gps_lon != null ? (
      <a
        className="link"
        href={`https://www.openstreetmap.org/?mlat=${photo.gps_lat}&mlon=${photo.gps_lon}#map=15/${photo.gps_lat}/${photo.gps_lon}`}
        target="_blank"
        rel="noreferrer"
      >
        {photo.gps_lat.toFixed(5)}, {photo.gps_lon.toFixed(5)}
      </a>
    ) : (
      "—"
    );

  // 配置驱动的字段表：show=false 的行（视频无关的拍摄参数）会被过滤掉
  const rows: { label: string; value: React.ReactNode; show?: boolean }[] = [
    { label: "拍摄时间", value: formatDate(photo.taken_at) },
    { label: "尺寸", value: dims },
    { label: "时长", value: formatDuration(photo.duration) || "—", show: isVideo },
    { label: "大小", value: formatSize(photo.file_size) },
    { label: "格式", value: photo.ext.toUpperCase() },
    { label: "相机", value: joinCamera(photo) },
    { label: "镜头", value: photo.lens ?? "—", show: !isVideo },
    { label: "光圈", value: photo.aperture ? `f/${photo.aperture}` : "—", show: !isVideo },
    { label: "快门", value: photo.shutter ?? "—", show: !isVideo },
    { label: "ISO", value: photo.iso ? String(photo.iso) : "—", show: !isVideo },
    {
      label: "焦距",
      value: photo.focal_length ? `${Math.round(photo.focal_length)} mm` : "—",
      show: !isVideo,
    },
    { label: "定位", value: gps },
  ];

  return (
    <div className="detail" onClick={(e) => e.stopPropagation()}>
      <div className="detail__head">
        <h2 className="detail__title" title={photo.filename}>
          {photo.filename}
        </h2>
        <button className="btn btn--icon" onClick={onClose} aria-label="关闭 (Esc)" title="关闭 (Esc)">
          ✕
        </button>
      </div>

      <div className="detail__exposure">
        {isVideo && <span className="badge-video">视频</span>}
        {subtitle}
      </div>

      <dl className="detail__grid">
        {rows
          .filter((r) => r.show !== false)
          .map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
      </dl>

      <div className="detail__path" title={photo.path}>
        {photo.path}
      </div>
      <button className="btn detail__reveal" onClick={() => revealInFinder(photo.path)}>
        在访达中显示
      </button>
    </div>
  );
}

function joinCamera(p: Photo): string {
  const parts = [p.camera_make, p.camera_model].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="detail__dt">{label}</dt>
      <dd className="detail__dd">{value}</dd>
    </>
  );
}
