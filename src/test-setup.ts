// 所有测试文件共用的环境准备（vite.config.ts 的 test.setupFiles 引用）。

// 固定界面语言为中文。i18next 的 LanguageDetector 会跟着 navigator.language 走，
// 而 jsdom 报的是 en-US——不锁住的话断言中文文案的用例会因为宿主语言而挂，
// 且换台机器结果还不一样。setupFiles 先于测试文件加载，这行赶在 i18n 初始化之前生效。
localStorage.setItem("lang", "zh");

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// 每个用例后卸载组件。@testing-library 的自动清理只在开了 globals 时才挂得上
// 全局 afterEach，本项目用显式 import 风格，所以必须自己挂——否则上一个用例的
// DOM 会留在 document 里，querySelector 取到的是**前一个组件**，
// 症状是测试报出的值风马牛不相及（问 b.jpg 却答 c.jpg），极难往清理上想。
afterEach(cleanup);

// jsdom 没有 ResizeObserver，而 ViewerStage 用它重算 1:1 基准。
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
