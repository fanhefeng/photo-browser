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
 *
 * 关键实现：
 * - 滚轮缩放用**原生 wheel 监听 + {passive:false}**，React 合成事件的 wheel
 *   是被动监听，其 `preventDefault` 会被忽略，导致放大态下页面穿透滚动。
 * - 平移的 mousemove/mouseup 挂在 **window** 上，避免放大后鼠标移出舞台丢事件、拖拽“粘手”。
 */
export function useZoom(resetKey: string) {
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // 实时镜像，供事件回调读取最新缩放而不必进依赖数组
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

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

  // 原生 wheel 监听：passive:false 才能 preventDefault，阻止放大态下的穿透滚动
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * ZOOM_SENSITIVITY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (zoomRef.current.scale > 1) reset();
      else zoomAt(e.clientX, e.clientY, 2.5);
    },
    [zoomAt, reset]
  );

  // 拖拽平移：mousedown 时在 window 上挂 move/up，越界也不丢事件
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomRef.current.scale <= 1) return;
    e.preventDefault();
    const start = {
      x: e.clientX,
      y: e.clientY,
      ox: zoomRef.current.x,
      oy: zoomRef.current.y,
    };
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      setZoom((z) => ({
        ...z,
        x: start.ox + (ev.clientX - start.x),
        y: start.oy + (ev.clientY - start.y),
      }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const cursor = zoom.scale > 1 ? (dragging ? "grabbing" : "grab") : "default";

  return {
    zoom,
    stageRef,
    setScale,
    reset,
    bind: {
      onDoubleClick,
      onMouseDown,
      style: { cursor } as React.CSSProperties,
    },
  };
}
