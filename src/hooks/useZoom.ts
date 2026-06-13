import { useCallback, useEffect, useRef, useState } from "react";

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_SCALE = 8;
// 滚轮/触控板缩放灵敏度：deltaY 经此系数映射到指数缩放因子
const ZOOM_SENSITIVITY = 0.0015;

/**
 * 大图缩放 + 平移。`resetKey` 变化时（切换照片）自动复位。
 * 返回绑定到舞台容器的事件处理器与当前缩放状态。
 */
export function useZoom(resetKey: string) {
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setZoom({ scale: 1, x: 0, y: 0 });
  }, [resetKey]);

  const reset = useCallback(() => setZoom({ scale: 1, x: 0, y: 0 }), []);

  // 以某个屏幕坐标为锚点缩放（保持该点在视觉上不动）
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

  const setScale = useCallback(
    (factor: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt]
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * ZOOM_SENSITIVITY));
    },
    [zoomAt]
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (zoom.scale > 1) reset();
      else zoomAt(e.clientX, e.clientY, 2.5);
    },
    [zoom.scale, zoomAt, reset]
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom.scale <= 1) return;
      e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y };
    },
    [zoom]
  );
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    setZoom((z) => ({ ...z, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  }, []);
  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const cursor = zoom.scale > 1 ? (drag.current ? "grabbing" : "grab") : "default";

  return {
    zoom,
    stageRef,
    setScale,
    reset,
    bind: {
      onWheel,
      onDoubleClick,
      onMouseDown,
      onMouseMove,
      onMouseUp: endDrag,
      onMouseLeave: endDrag,
      style: { cursor } as React.CSSProperties,
    },
  };
}
