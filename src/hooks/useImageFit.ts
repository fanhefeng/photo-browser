import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 图片"适应舞台"时的尺寸（CSS px）与 1:1 所需的相对缩放。 */
export interface ImageFit {
  w: number;
  h: number;
  /** 相对适应尺寸的 scale，使 1 图像像素 = 1 设备像素（HiDPI 已换算） */
  scale100: number;
}

/** 由舞台尺寸 + 图像像素尺寸算出适应尺寸。任一尺寸未知（0）时返回 null。 */
export function computeFit(
  stageW: number,
  stageH: number,
  imageW: number,
  imageH: number,
  dpr: number
): ImageFit | null {
  if (!(stageW > 0 && stageH > 0 && imageW > 0 && imageH > 0)) return null;
  const ar = imageW / imageH;
  const w = Math.min(stageW, stageH * ar);
  const h = w / ar;
  return { w, h, scale100: imageW / (w * (dpr || 1)) };
}

/**
 * 当前图源的像素是否已不够用：放大后画面占用的设备像素超过了图源宽度，
 * 而原图还有更多像素可挖。用于 HEIC 等走 3840px 预览的格式——放大到超过预览
 * 分辨率时再换原图/全分辨率转码，平时仍用轻量预览。
 */
export function needsSharperSource(
  fit: ImageFit,
  scale: number,
  dpr: number,
  sourceW: number,
  originalW: number
): boolean {
  if (!(sourceW > 0) || originalW <= sourceW) return false;
  // 留 5% 余量：轻微超出时双线性插值肉眼不可辨，没必要为此解码几十 MB 的原图
  return fit.w * scale * (dpr || 1) > sourceW * 1.05;
}

/**
 * 跟踪图片在舞台内的适应尺寸。缩放改的是 <img> 的真实布局尺寸而非 CSS transform：
 * transform 只是把"适应尺寸时光栅化好的那张位图"拉大，1:1 时 1px 棋盘会糊成一片灰；
 * 改布局尺寸后 WebKit 按目标尺寸从解码后的原图重新采样，锐度与 Preview/照片 App 一致。
 *
 * `original` 为索引里已知的原图像素尺寸（Lightbox 先显示缩略图占位，naturalWidth
 * 是占位图的，不能拿来算 1:1）；不传则用 img.naturalWidth（查看器直载原图）。
 */
export function useImageFit(
  stageRef: RefObject<HTMLDivElement | null>,
  original?: { width: number; height: number } | null
) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<ImageFit | null>(null);
  const originalRef = useRef(original);
  originalRef.current = original;

  const recalc = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    const r = stage.getBoundingClientRect();
    const o = originalRef.current;
    const w = o?.width || img.naturalWidth;
    const h = o?.height || img.naturalHeight;
    // 每次都换新对象：同尺寸的相邻两张也要让依赖 fit 的 effect 重跑（查看器切图后 scale100 置空，靠它回填）
    setFit(computeFit(r.width, r.height, w, h, window.devicePixelRatio || 1));
  }, [stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(recalc);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [recalc, stageRef]);

  return { fit, imgRef, onLoad: recalc };
}
