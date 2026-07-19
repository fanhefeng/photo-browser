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
 * `minScale`：滚轮/按钮缩小的下限（相对适应尺寸，默认 1 = 不小于适应）。
 * 查看器传 min(1, 1:1 对应的 scale)，让小图可以缩到实际像素大小。
 *
 * 关键实现：
 * - 滚轮缩放用**原生 wheel 监听 + {passive:false}**，React 合成事件的 wheel
 *   是被动监听，其 `preventDefault` 会被忽略，导致放大态下页面穿透滚动。
 * - wheel 监听通过 `bind.ref`（callback ref）在舞台节点挂载/更换时增删——
 *   hook 可能在舞台尚不存在时调用（查看器把缩放状态提到了顶层），
 *   若用一次性 effect 绑定会永远错过节点。
 * - 平移的 mousemove/mouseup 挂在 **window** 上，避免放大后鼠标移出舞台丢事件、拖拽“粘手”。
 */
export function useZoom(resetKey: string, minScale = 1) {
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 实时镜像，供事件回调读取最新缩放而不必进依赖数组
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // minScale 走 ref：图片加载后才知道 1:1 对应的 scale，变化时无需重建 wheel 监听
  const minRef = useRef(minScale);
  minRef.current = clamp(minScale, 0.02, 1);

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
      // scale ≤ 1 时图片不超出舞台，平移归零居中
      const scale = clamp(z.scale * factor, minRef.current, MAX_SCALE);
      if (scale <= 1) return { scale, x: 0, y: 0 };
      const ratio = scale / z.scale;
      return { scale, x: cx - (cx - z.x) * ratio, y: cy - (cy - z.y) * ratio };
    });
  }, []);

  // 绝对缩放（查看器"1:1 实际像素"用）：居中显示
  const zoomTo = useCallback((scale: number) => {
    setZoom({ scale: clamp(scale, 0.02, MAX_SCALE), x: 0, y: 0 });
  }, []);

  const setScale = useCallback(
    (factor: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt]
  );

  // 原生 wheel 监听：passive:false 才能 preventDefault，阻止放大态下的穿透滚动。
  // callback ref：节点 attach 时绑、detach/更换（key 重挂）时解绑。
  const wheelCleanup = useRef<(() => void) | null>(null);
  const bindStage = useCallback(
    (el: HTMLDivElement | null) => {
      wheelCleanup.current?.();
      wheelCleanup.current = null;
      stageRef.current = el;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * ZOOM_SENSITIVITY));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      wheelCleanup.current = () => el.removeEventListener("wheel", onWheel);
    },
    [zoomAt]
  );

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
    /** 只读访问舞台节点（尺寸计算用）；绑定到 DOM 请用 bind.ref */
    stageRef,
    setScale,
    zoomTo,
    reset,
    bind: {
      ref: bindStage,
      onDoubleClick,
      onMouseDown,
      style: { cursor } as React.CSSProperties,
    },
  };
}
