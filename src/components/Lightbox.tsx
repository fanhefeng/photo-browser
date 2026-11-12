import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaItem } from "../types";
import {
  ensurePreview,
  originalSrc,
  previewUrl,
  thumbUrl,
  videoSrc,
  viewerPreview,
  vpreviewUrl,
} from "../api";
import { isWebDisplayable } from "../utils";
import { useZoom } from "../hooks/useZoom";
import { needsSharperSource, useImageFit } from "../hooks/useImageFit";
import { DetailPanel, VideoStage, ZoomBar, zoomedImageStyle } from "./media";

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
            {t("lightbox.prev")}
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
            {t("lightbox.next")}
          </button>
        )}
      </div>

      <DetailPanel photo={photo} onClose={onClose} />
    </div>
  );
}

/** 照片查看：缩放 + 平移（逻辑封装在 useZoom） */
function PhotoStage({ photo, neighbors }: { photo: MediaItem; neighbors: (MediaItem | undefined)[] }) {
  const { t } = useTranslation();
  // 当前显示的图源：先缩略图占位，高清图后台预解码完成后再整体替换
  const [src, setSrc] = useState(() => thumbUrl(photo.id, photo.mtime));
  const loaderRef = useRef<HTMLImageElement | null>(null);
  // 代次：切换照片后，上一张还在途的预解码回调不得把旧图换进来
  const genRef = useRef(0);
  // 原图尺寸来自索引：占位缩略图的 naturalWidth 不能拿来算 1:1
  const original = photo.width && photo.height ? { width: photo.width, height: photo.height } : null;
  // 舞台节点由本组件持有：useImageFit 要先于 useZoom 拿到 fit（算下限），
  // 而 useZoom 自己的 stageRef 又只在其 bind.ref 里赋值，直接用会形成循环依赖。
  const stageElRef = useRef<HTMLDivElement | null>(null);
  const { fit, imgRef, onLoad } = useImageFit(stageElRef, original);
  // 小图允许缩到实际像素（与查看器一致）；大图下限仍是适应尺寸
  const { zoom, setScale, zoomTo, reset, bind } = useZoom(
    photo.id,
    fit ? Math.min(1, fit.scale100) : 1
  );
  const bindRef = bind.ref;
  const stageRef = useCallback(
    (el: HTMLDivElement | null) => {
      stageElRef.current = el;
      bindRef(el);
    },
    [bindRef]
  );

  const swapWhenLoaded = useCallback((url: string, onFail?: () => void) => {
    const gen = genRef.current;
    const img = new Image();
    loaderRef.current = img;
    img.onload = () => gen === genRef.current && setSrc(url);
    img.onerror = () => gen === genRef.current && onFail?.();
    img.src = url;
  }, []);

  useEffect(() => {
    setSrc(thumbUrl(photo.id, photo.mtime));
    upgradedRef.current = false;
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
      genRef.current += 1;
      if (loaderRef.current) loaderRef.current.src = "";
    };
    // mtime 必须在依赖里：重扫后同 id 文件内容可能已变，不重跑此 effect 的话
    // src 会停留在旧 ?v= 的 URL 上，被协议层的一年强缓存钉死显示旧图
  }, [photo.id, photo.mtime]); // eslint-disable-line react-hooks/exhaustive-deps

  // HEIC/TIFF 等走 3840px 预览的格式：放大到超过预览分辨率时升级到原图
  // （WebView 在 macOS 上能原生解码 HEIC），原生解码不了的再走 sips 全分辨率转码。
  // 只在预览已显示后判断——占位缩略图阶段 naturalWidth 是缩略图的，会误判。
  // 每张只升级一次（切换照片时复位），失败也不重试，避免反复解码几十 MB 的原图。
  const upgradedRef = useRef(false);
  useEffect(() => {
    const img = imgRef.current;
    if (!fit || !img || !src.startsWith("preview://") || upgradedRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    if (!needsSharperSource(fit, zoom.scale, dpr, img.naturalWidth, photo.width ?? 0)) return;
    upgradedRef.current = true;
    swapWhenLoaded(originalSrc(photo.path), () => {
      viewerPreview(photo.path)
        .then((id) => swapWhenLoaded(`${vpreviewUrl(id)}?t=${Date.now()}`))
        .catch(() => {});
    });
  }, [zoom.scale, fit, src, photo.path, photo.width, imgRef, swapWhenLoaded]);

  return (
    <div className="zoom-stage" onClick={(e) => e.stopPropagation()} {...bind} ref={stageRef}>
      <img
        ref={imgRef}
        className="lightbox__img"
        src={src}
        alt={photo.filename}
        draggable={false}
        onLoad={onLoad}
        style={zoomedImageStyle(zoom, fit)}
      />

      <ZoomBar
        scale={zoom.scale}
        setScale={setScale}
        reset={reset}
        pctScale={fit ? 1 / fit.scale100 : 1}
      >
        <button
          className="zoom-bar__btn zoom-bar__btn--text"
          onClick={() => fit && zoomTo(fit.scale100)}
          title={t("viewer.actualSize")}
        >
          1:1
        </button>
      </ZoomBar>
    </div>
  );
}
