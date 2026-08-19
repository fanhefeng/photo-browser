// useZoom 的缩放数学。这些断言盯的是"光标下那个点必须原地不动"——
// 符号写反、锚点算成舞台左上角而非中心，肉眼都只是"缩放感觉怪怪的"，
// 不会报错也不会崩，正是最该由测试钉住的那类逻辑。
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useZoom } from "./useZoom";

/** 舞台固定为 800×600、左上角在 (100, 50)，于是中心在 (500, 350) */
const STAGE = { left: 100, top: 50, width: 800, height: 600 };
const CENTER = { x: STAGE.left + STAGE.width / 2, y: STAGE.top + STAGE.height / 2 };

/** 造一个尺寸固定的舞台节点并绑给 hook（jsdom 里元素尺寸恒为 0，必须自己伪造） */
function attachStage(bind: { ref: (el: HTMLDivElement | null) => void }) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ ...STAGE, right: STAGE.left + STAGE.width, bottom: STAGE.top + STAGE.height }) as DOMRect;
  document.body.appendChild(el);
  act(() => bind.ref(el));
  return el;
}

function wheel(el: HTMLElement, clientX: number, clientY: number, deltaY: number) {
  act(() => {
    el.dispatchEvent(new WheelEvent("wheel", { clientX, clientY, deltaY, cancelable: true }));
  });
}

describe("useZoom", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("以光标为锚点缩放：锚点处的图像内容保持不动", () => {
    const { result } = renderHook(() => useZoom("photo-a"));
    const el = attachStage(result.current.bind);

    // 光标停在中心右下方 (200, 100) 处向上滚 = 放大
    const cursor = { x: CENTER.x + 200, y: CENTER.y + 100 };
    wheel(el, cursor.x, cursor.y, -100);

    const { scale, x, y } = result.current.zoom;
    expect(scale).toBeGreaterThan(1);

    // 锚点不动的判据：缩放前后，光标处对应的"图像坐标"一致。
    // 舞台中心为原点，屏幕点 p 映射到图像坐标 (p - center - translate) / scale。
    // 缩放前 translate=(0,0)、scale=1，所以图像坐标就是光标相对中心的偏移。
    const before = { x: cursor.x - CENTER.x, y: cursor.y - CENTER.y };
    const after = {
      x: (cursor.x - CENTER.x - x) / scale,
      y: (cursor.y - CENTER.y - y) / scale,
    };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("缩回到适应尺寸时平移归零，图不会卡在偏移位置", () => {
    const { result } = renderHook(() => useZoom("photo-a"));
    const el = attachStage(result.current.bind);

    // 先在偏离中心处放大，制造非零平移
    wheel(el, CENTER.x + 300, CENTER.y, -200);
    expect(result.current.zoom.x).not.toBe(0);

    // 再大幅缩小回到 scale <= 1
    wheel(el, CENTER.x + 300, CENTER.y, 2000);

    expect(result.current.zoom.scale).toBeLessThanOrEqual(1);
    expect(result.current.zoom).toMatchObject({ x: 0, y: 0 });
  });

  it("默认下限是适应尺寸（1），查看器传入的 minScale 才允许缩到实际像素", () => {
    // 默认：怎么滚都不小于 1
    const fit = renderHook(() => useZoom("photo-a"));
    const fitEl = attachStage(fit.result.current.bind);
    wheel(fitEl, CENTER.x, CENTER.y, 5000);
    expect(fit.result.current.zoom.scale).toBe(1);

    // 查看器：小图的 1:1 比适应尺寸更小，必须能缩下去
    document.body.innerHTML = "";
    const viewer = renderHook(() => useZoom("photo-b", 0.25));
    const viewerEl = attachStage(viewer.result.current.bind);
    wheel(viewerEl, CENTER.x, CENTER.y, 5000);
    expect(viewer.result.current.zoom.scale).toBeCloseTo(0.25, 6);
  });

  it("切换照片时复位缩放，不把上一张的放大状态带过去", () => {
    const { result, rerender } = renderHook(({ key }) => useZoom(key), {
      initialProps: { key: "photo-a" },
    });
    const el = attachStage(result.current.bind);

    wheel(el, CENTER.x + 100, CENTER.y, -300);
    expect(result.current.zoom.scale).toBeGreaterThan(1);

    rerender({ key: "photo-b" });
    expect(result.current.zoom).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  it("缩放有上限，滚轮压不爆", () => {
    const { result } = renderHook(() => useZoom("photo-a"));
    const el = attachStage(result.current.bind);
    for (let i = 0; i < 20; i++) wheel(el, CENTER.x, CENTER.y, -500);
    expect(result.current.zoom.scale).toBe(8);
  });
});
