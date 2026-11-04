// 适应尺寸 / 1:1 / "该换更清晰图源了吗"的纯数学。算错了不会报错，
// 只是 1:1 按钮显示成 200% 或者放大后一直糊着——正是该钉住的那类逻辑。
import { describe, expect, it } from "vite-plus/test";

import { computeFit, needsSharperSource } from "./useImageFit";

describe("computeFit", () => {
  it("横图受宽限制、竖图受高限制，宽高比不变", () => {
    const wide = computeFit(800, 600, 4000, 2000, 2)!;
    expect(wide.w).toBe(800);
    expect(wide.h).toBe(400);

    const tall = computeFit(800, 600, 354, 2048, 2)!;
    expect(tall.h).toBeCloseTo(600, 6);
    expect(tall.w).toBeCloseTo(600 * (354 / 2048), 6);
  });

  it("scale100 换算 HiDPI：Retina 上 1:1 需要的相对缩放是原图宽 / (适应宽 × dpr)", () => {
    // 4000px 宽的图适应到 800 CSS px、dpr=2 → 1600 设备像素，1:1 还要再放大 2.5×
    expect(computeFit(800, 600, 4000, 2000, 2)!.scale100).toBeCloseTo(2.5, 6);
    // 小图：适应时已经超过 1:1，scale100 < 1
    expect(computeFit(800, 600, 400, 200, 2)!.scale100).toBeCloseTo(0.25, 6);
  });

  it("尺寸未知时返回 null，而不是 NaN/Infinity 混进样式", () => {
    expect(computeFit(0, 600, 4000, 2000, 2)).toBeNull();
    expect(computeFit(800, 600, 0, 0, 2)).toBeNull();
  });
});

describe("needsSharperSource", () => {
  // 8064px 的 HEIC 走 3840px 预览，适应到 1000 CSS px、dpr=2
  const fit = computeFit(1000, 800, 8064, 6048, 2)!;

  it("放大到画面像素超过预览像素时才要求原图", () => {
    // 2000 设备像素 < 3840：预览够用
    expect(needsSharperSource(fit, 1, 2, 3840, 8064)).toBe(false);
    // 1.9× → 3800 < 3840×1.05：仍在余量内
    expect(needsSharperSource(fit, 1.9, 2, 3840, 8064)).toBe(false);
    // 2.2× → 4400 > 4032：换原图
    expect(needsSharperSource(fit, 2.2, 2, 3840, 8064)).toBe(true);
  });

  it("原图并不比当前图源大（已是原图/原图未知）时永不触发，避免无谓的重复解码", () => {
    expect(needsSharperSource(fit, 8, 2, 8064, 8064)).toBe(false);
    expect(needsSharperSource(fit, 8, 2, 3840, 0)).toBe(false);
    expect(needsSharperSource(fit, 8, 2, 0, 8064)).toBe(false);
  });
});
