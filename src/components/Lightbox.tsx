import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaItem } from "../types";
import {
  ensurePreview,
  originalSrc,
  previewUrl,
  thumbUrl,
  videoSrc,
} from "../api";
import { isWebDisplayable } from "../utils";
import { useZoom } from "../hooks/useZoom";
import { DetailPanel, VideoStage, ZoomBar } from "./media";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

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

  // 键盘导航。焦点在视频控件上时方向键留给播放器快进/快退（与查看器一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const onVideo = (e.target as HTMLElement | null)?.tagName === "VIDEO";
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && !onVideo && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && !onVideo && index < photos.length - 1)
        onNavigate(index + 1);
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
            <ChevronLeftIcon size={26} />
          </button>
        )}

        {isVideo ? (
          <VideoStage key={photo.id} src={videoSrc(photo.path)} />
        ) : (
          <PhotoStage photo={photo} neighbors={[photos[index - 1], photos[index + 1]]} />
        )}

        {index < photos.length - 1 && (
          <button
            className="lightbox__nav lightbox__nav--next"
            onClick={() => onNavigate(index + 1)}
            aria-label={t("lightbox.next")}
          >
            <ChevronRightIcon size={26} />
          </button>
        )}
      </div>

      <DetailPanel photo={photo} onClose={onClose} />
    </div>
  );
}

/** 照片查看：缩放 + 平移（逻辑封装在 useZoom） */
function PhotoStage({ photo, neighbors }: { photo: MediaItem; neighbors: (MediaItem | undefined)[] }) {
  // 当前显示的图源：先缩略图占位，高清图后台预解码完成后再整体替换
  const [src, setSrc] = useState(() => thumbUrl(photo.id, photo.mtime));
  const loaderRef = useRef<HTMLImageElement | null>(null);
  const { zoom, setScale, reset, bind } = useZoom(photo.id);

  useEffect(() => {
    setSrc(thumbUrl(photo.id, photo.mtime));
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
        .then((ok) => ok && swapWhenLoaded(previewUrl(photo.id, photo.mtime)))
        .catch(() => {});

    if (isWebDisplayable(photo.ext)) {
      swapWhenLoaded(originalSrc(photo.path), loadPreview);
    } else {
      void loadPreview();
    }
    // 相邻预热：可直接解码的预热原图（WebView 缓存），其余预生成 preview
    neighbors.forEach((n) => {
      if (!n || n.kind !== "photo") return;
      if (isWebDisplayable(n.ext)) new Image().src = originalSrc(n.path);
      else ensurePreview(n.id).catch(() => {});
    });
    return () => {
      alive = false;
      if (loaderRef.current) loaderRef.current.src = "";
    };
  }, [photo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="zoom-stage" onClick={(e) => e.stopPropagation()} {...bind}>
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

      <ZoomBar scale={zoom.scale} setScale={setScale} reset={reset} />
    </div>
  );
}
