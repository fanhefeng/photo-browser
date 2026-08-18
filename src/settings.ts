// 应用设置：localStorage 持久化 + 订阅式读取（useSyncExternalStore）。
// 主题注册表也在这里——新增主题 = themes.css 加一个 [data-theme] 块 +
// THEMES 注册一行 + i18n 加 settings.theme.<id> 名称。
// 语言不在此列（由 i18next 的 localStorage "lang" 管理，见 i18n/index.ts）。

import { useSyncExternalStore } from "react";

export const THEMES = [
  { id: "light" }, // 经典浅色（默认，token 见 themes.css 首块）
  { id: "cream" }, // 奶油贴纸（取自 app icon 配色）
  { id: "dark" }, // 石墨深色
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

export interface AppSettings {
  theme: ThemeId;
  thumbSize: number; // 网格缩略图边长 px（THUMB_MIN..THUMB_MAX）
  hoverInfo: boolean; // 悬停缩略图时显示文件名/日期
  autoCheckUpdate: boolean; // 启动 3s 后静默检查更新（仅 prod 生效）
}

export const THUMB_MIN = 120;
export const THUMB_MAX = 240;

const DEFAULTS: AppSettings = {
  theme: "light",
  thumbSize: 168,
  hoverInfo: true,
  autoCheckUpdate: true,
};
const STORAGE_KEY = "settings";

/** 逐字段校验：localStorage 可能是旧版本写的或被手改过，坏值回退默认。 */
function sanitize(raw: unknown): AppSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const theme = THEMES.some((t) => t.id === o.theme) ? (o.theme as ThemeId) : DEFAULTS.theme;
  const thumbSize =
    typeof o.thumbSize === "number" && Number.isFinite(o.thumbSize)
      ? Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(o.thumbSize)))
      : DEFAULTS.thumbSize;
  return {
    theme,
    thumbSize,
    hoverInfo: typeof o.hoverInfo === "boolean" ? o.hoverInfo : DEFAULTS.hoverInfo,
    autoCheckUpdate:
      typeof o.autoCheckUpdate === "boolean" ? o.autoCheckUpdate : DEFAULTS.autoCheckUpdate,
  };
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: AppSettings = load();
const listeners = new Set<() => void>();

function apply(s: AppSettings) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.hoverInfo = s.hoverInfo ? "on" : "off";
  root.style.setProperty("--thumb", `${s.thumbSize}px`);
}

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings(patch: Partial<AppSettings>) {
  current = sanitize({ ...current, ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // 存储失败（如隐私模式）不影响本次会话生效
  }
  apply(current);
  listeners.forEach((l) => l());
}

/** React 组件里订阅设置（设置变更即重渲染）。 */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 主窗口启动时调用一次（main.tsx，React 渲染前，避免主题闪烁）。
 *  查看器窗口不调用：它不换肤，固定 Quick Look 深色玻璃（html.viewer-window）。 */
export function initSettings() {
  apply(current);
}
