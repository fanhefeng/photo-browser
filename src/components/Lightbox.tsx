import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaItem } from "../types";
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
  photos: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export default function Lightbox({ photos, index, onClose, onNavigate }: Props) {
  const { t } = useTranslation();
  const photo = photos[index];
  const isVideo = photo.kind === "video";
  const rootRef = useRef<HTMLDivElement>(null);

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

  // 打开时接管焦点（避免焦点滞留在背景网格），关闭时还原到来源元素
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <div
      ref={rootRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={photo.filename}
      tabIndex={-1}
      onClick={onClose}
    >
      <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            className="lightbox__nav lightbox__nav--prev"
            onClick={() => onNavigate(index - 1)}
            aria-label={t("lightbox.prev")}
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
            aria-label={t("lightbox.next")}
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
function VideoStage({ photo }: { photo: MediaItem }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="media-error" onClick={(e) => e.stopPropagation()}>
        {t("lightbox.videoError")}
        <br />
        <span className="media-error__sub">{t("lightbox.videoErrorSub")}</span>
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
function PhotoStage({ photo, neighbors }: { photo: MediaItem; neighbors: (MediaItem | undefined)[] }) {
  const { t } = useTranslation();
  // 当前显示的图源：先缩略图占位，高清图后台预解码完成后再整体替换
  const [src, setSrc] = useState(() => thumbUrl(photo.id));
  const loaderRef = useRef<HTMLImageElement | null>(null);
  const { zoom, stageRef, setScale, reset, bind } = useZoom(photo.id);

  useEffect(() => {
    setSrc(thumbUrl(photo.id));
    let alive = true;
    const swapWhenLoaded = (url: string, onFail?: () => void) => {
      const img = new Image();
      loaderRef.current = img;
      img.onload = () => alive && setSrc(url);
      img.onerror = () => alive && onFail?.();
      img.src = url;
    };
    const loadPreview = () =>
      ensurePreview(photo.id)
        .then((ok) => ok && swapWhenLoaded(previewUrl(photo.id)))
        .catch(() => {});

    if (isWebDisplayable(photo.ext)) {
      swapWhenLoaded(originalSrc(photo.path), loadPreview);
    } else {
      loadPreview();
    }
    neighbors.forEach((n) => {
      if (n && n.kind === "photo" && !isWebDisplayable(n.ext)) ensurePreview(n.id).catch(() => {});
    });
    return () => {
      alive = false;
      if (loaderRef.current) loaderRef.current.src = "";
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
        <button className="zoom-bar__btn" onClick={() => setScale(1 / 1.4)} aria-label={t("lightbox.zoomOut")}>
          −
        </button>
        <span className="zoom-bar__pct">{Math.round(zoom.scale * 100)}%</span>
        <button className="zoom-bar__btn" onClick={() => setScale(1.4)} aria-label={t("lightbox.zoomIn")}>
          +
        </button>
        <button className="zoom-bar__btn" onClick={reset} aria-label={t("lightbox.fit")}>
          ⤢
        </button>
      </div>
    </div>
  );
}

function DetailPanel({ photo, onClose }: { photo: MediaItem; onClose: () => void }) {
  const { t } = useTranslation();
  const dash = t("common.dash");
  const isVideo = photo.kind === "video";
  const dims = photo.width && photo.height ? `${photo.width} × ${photo.height}` : dash;
  const subtitle = isVideo
    ? [formatDuration(photo.duration), dims !== dash ? dims : ""].filter(Boolean).join(" · ") ||
      t("detail.video")
    : formatExposure(photo) || t("detail.noParams");

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
      dash
    );

  // 配置驱动的字段表：show=false 的行（视频无关的拍摄参数）会被过滤掉
  const rows: { label: string; value: React.ReactNode; show?: boolean }[] = [
    { label: t("detail.field.taken_at"), value: formatDate(photo.taken_at) },
    { label: t("detail.field.dims"), value: dims },
    { label: t("detail.field.duration"), value: formatDuration(photo.duration) || dash, show: isVideo },
    { label: t("detail.field.size"), value: formatSize(photo.file_size) },
    { label: t("detail.field.format"), value: photo.ext.toUpperCase() },
    { label: t("detail.field.camera"), value: joinCamera(photo, dash) },
    { label: t("detail.field.lens"), value: photo.lens ?? dash, show: !isVideo },
    { label: t("detail.field.aperture"), value: photo.aperture ? `f/${photo.aperture}` : dash, show: !isVideo },
    { label: t("detail.field.shutter"), value: photo.shutter ?? dash, show: !isVideo },
    { label: t("detail.field.iso"), value: photo.iso ? String(photo.iso) : dash, show: !isVideo },
    {
      label: t("detail.field.focal_length"),
      value: photo.focal_length ? `${Math.round(photo.focal_length)} mm` : dash,
      show: !isVideo,
    },
    { label: t("detail.field.gps"), value: gps },
  ];

  return (
    <div className="detail" onClick={(e) => e.stopPropagation()}>
      <div className="detail__head">
        <h2 className="detail__title" title={photo.filename}>
          {photo.filename}
        </h2>
        <button
          className="btn btn--icon"
          onClick={onClose}
          aria-label={t("detail.close")}
          title={t("detail.close")}
        >
          ✕
        </button>
      </div>

      <div className="detail__exposure">
        {isVideo && <span className="badge-video">{t("detail.video")}</span>}
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
      <button
        className="btn detail__reveal"
        onClick={() => revealInFinder(photo.path).catch(() => {})}
      >
        {t("detail.reveal")}
      </button>
    </div>
  );
}

function joinCamera(p: MediaItem, dash: string): string {
  const parts = [p.camera_make, p.camera_model].filter(Boolean);
  return parts.length ? parts.join(" ") : dash;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="detail__dt">{label}</dt>
      <dd className="detail__dd">{value}</dd>
    </>
  );
}
