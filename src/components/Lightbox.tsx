import { useCallback, useEffect, useRef, useState } from "react";
import type { Photo } from "../types";
import {
  ensurePreview,
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
} from "../utils";

interface Props {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_SCALE = 8;

export default function Lightbox({ photos, index, onClose, onNavigate }: Props) {
  const photo = photos[index];
  const isVideo = photo.kind === "video";

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox__stage" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button
            className="lightbox__nav lightbox__nav--prev"
            onClick={() => onNavigate(index - 1)}
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
          >
            ›
          </button>
        )}
      </div>

      <DetailPanel photo={photo} onClose={onClose} />

      {/* 键盘导航 */}
      <KeyNav
        index={index}
        count={photos.length}
        onClose={onClose}
        onNavigate={onNavigate}
      />
    </div>
  );
}

/** 视频播放（asset 协议，支持拖动进度） */
function VideoStage({ photo }: { photo: Photo }) {
  return (
    <video
      key={photo.id}
      className="lightbox__video"
      src={videoSrc(photo.path)}
      poster={thumbUrl(photo.id)}
      controls
      autoPlay
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** 照片查看：缩放 + 平移 */
function PhotoStage({ photo, neighbors }: { photo: Photo; neighbors: (Photo | undefined)[] }) {
  const [previewReady, setPreviewReady] = useState(false);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // 切换照片：重置缩放，按需生成高清预览，预热相邻
  useEffect(() => {
    setZoom({ scale: 1, x: 0, y: 0 });
    setPreviewReady(false);
    let alive = true;
    ensurePreview(photo.id).then((ok) => alive && setPreviewReady(ok));
    neighbors.forEach((n) => {
      if (n && n.kind !== "video") ensurePreview(n.id);
    });
    return () => {
      alive = false;
    };
  }, [photo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 以光标为锚点缩放
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = clientX - (rect.left + rect.width / 2);
    const cy = clientY - (rect.top + rect.height / 2);
    setZoom((z) => {
      const scale = clamp(z.scale * factor, 1, MAX_SCALE);
      if (scale === 1) return { scale: 1, x: 0, y: 0 };
      const ratio = scale / z.scale;
      return { scale, x: cx - (cx - z.x) * ratio, y: cy - (cy - z.y) * ratio };
    });
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (zoom.scale > 1) setZoom({ scale: 1, x: 0, y: 0 });
    else zoomAt(e.clientX, e.clientY, 2.5);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom.scale <= 1) return;
    e.preventDefault();
    drag.current = { x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    setZoom((z) => ({
      ...z,
      x: drag.current!.ox + (e.clientX - drag.current!.x),
      y: drag.current!.oy + (e.clientY - drag.current!.y),
    }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const setScale = (factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  return (
    <div
      ref={stageRef}
      className="zoom-stage"
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: zoom.scale > 1 ? (drag.current ? "grabbing" : "grab") : "default" }}
    >
      <img
        className="lightbox__img"
        src={previewReady ? previewUrl(photo.id) : thumbUrl(photo.id)}
        alt={photo.filename}
        draggable={false}
        style={{
          transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
          transition: drag.current ? "none" : "transform 0.12s ease-out",
        }}
      />

      <div className="zoom-bar" onClick={(e) => e.stopPropagation()}>
        <button className="zoom-bar__btn" onClick={() => setScale(1 / 1.4)} title="缩小">
          −
        </button>
        <span className="zoom-bar__pct">{Math.round(zoom.scale * 100)}%</span>
        <button className="zoom-bar__btn" onClick={() => setScale(1.4)} title="放大">
          +
        </button>
        <button
          className="zoom-bar__btn"
          onClick={() => setZoom({ scale: 1, x: 0, y: 0 })}
          title="复位 (适应屏幕)"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

/** 键盘：Esc 关闭、左右翻页 */
function KeyNav({
  index,
  count,
  onClose,
  onNavigate,
}: {
  index: number;
  count: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && index < count - 1) onNavigate(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onNavigate]);
  return null;
}

function DetailPanel({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const isVideo = photo.kind === "video";
  const dims = photo.width && photo.height ? `${photo.width} × ${photo.height}` : "—";
  const subtitle = isVideo
    ? [formatDuration(photo.duration), dims !== "—" ? dims : ""].filter(Boolean).join(" · ") ||
      "视频"
    : formatExposure(photo) || "无拍摄参数";

  return (
    <div className="detail" onClick={(e) => e.stopPropagation()}>
      <div className="detail__head">
        <h2 className="detail__title" title={photo.filename}>
          {photo.filename}
        </h2>
        <button className="btn btn--icon" onClick={onClose} title="关闭 (Esc)">
          ✕
        </button>
      </div>

      <div className="detail__exposure">
        {isVideo && <span className="badge-video">视频</span>}
        {subtitle}
      </div>

      <dl className="detail__grid">
        <Row label="拍摄时间" value={formatDate(photo.taken_at)} />
        <Row label="尺寸" value={dims} />
        {isVideo && <Row label="时长" value={formatDuration(photo.duration) || "—"} />}
        <Row label="大小" value={formatSize(photo.file_size)} />
        <Row label="格式" value={photo.ext.toUpperCase()} />
        <Row label="相机" value={joinCamera(photo)} />
        {!isVideo && <Row label="镜头" value={photo.lens ?? "—"} />}
        {!isVideo && <Row label="光圈" value={photo.aperture ? `f/${photo.aperture}` : "—"} />}
        {!isVideo && <Row label="快门" value={photo.shutter ?? "—"} />}
        {!isVideo && <Row label="ISO" value={photo.iso ? String(photo.iso) : "—"} />}
        {!isVideo && (
          <Row
            label="焦距"
            value={photo.focal_length ? `${Math.round(photo.focal_length)} mm` : "—"}
          />
        )}
        <Row
          label="定位"
          value={
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
            )
          }
        />
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
