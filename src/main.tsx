import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./i18n";
import App from "./App";
import ViewerApp from "./ViewerApp";
import { initSettings } from "./settings";

// 按窗口 label 分流：main → 主浏览器，viewer → 独立查看器（"打开方式"进入）
const isViewer = getCurrentWindow().label === "viewer";
// 查看器是深色玻璃主题：尽早标记 html，避免加载瞬间白底闪烁
if (isViewer) {
  document.documentElement.classList.add("viewer-window");
} else {
  // 主窗口：渲染前应用已保存的主题/显示设置，避免默认主题闪烁
  initSettings();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isViewer ? <ViewerApp /> : <App />}
  </React.StrictMode>,
);
