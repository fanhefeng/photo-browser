// 对 Tauri 后端命令与自定义图片协议的封装

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { Facets, Filter, MediaItem } from "./types";

/** 弹出系统目录选择框，返回所选目录（取消返回 null） */
export async function pickDirectory(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

/** 扫描目录并建立索引；进度通过 scan-progress / scan-done 事件上报 */
export function scanDirectory(path: string): Promise<number> {
  return invoke<number>("scan_directory", { path });
}

/** 请求取消正在进行的扫描 */
export function cancelScan(): Promise<void> {
  return invoke("cancel_scan");
}

/** 视频功能是否可用（ffprobe/ffmpeg 是否就绪） */
export function videoSupport(): Promise<boolean> {
  return invoke<boolean>("video_support");
}

export interface AppInfo {
  env: string; // dev | prod
  data_dir: string;
  cache_dir: string;
  log_dir: string;
  db_path: string;
}

/** 运行环境与各目录地址（诊断用） */
export function appInfo(): Promise<AppInfo> {
  return invoke<AppInfo>("app_info");
}

export function queryPhotos(filter: Filter): Promise<MediaItem[]> {
  return invoke<MediaItem[]>("query_photos", { filter });
}

export function getFacets(root?: string): Promise<Facets> {
  return invoke<Facets>("get_facets", { root: root ?? null });
}

export function ensurePreview(id: string): Promise<boolean> {
  return invoke<boolean>("ensure_preview", { id });
}

export function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

/** 通知后端当前语言（zh/en），用于重建原生菜单的文案 */
export function setLocale(lang: string): Promise<void> {
  return invoke("set_locale", { lang });
}

/** 缩略图 URL（自定义协议，WebView 原生加载/缓存） */
export const thumbUrl = (id: string) => `thumb://localhost/${id}.jpg`;

/** 大图预览 URL（需先调用 ensurePreview 生成） */
export const previewUrl = (id: string) => `preview://localhost/${id}.jpg`;

/** 原始文件 URL（走 Tauri asset 协议）。
 *  视频用它支持 Range 拖动进度；浏览器可直接解码的图片用它呈现原图清晰度。 */
const assetUrl = (path: string) => convertFileSrc(path);
export const videoSrc = assetUrl;
export const originalSrc = assetUrl;

/** macOS 红绿灯避让区宽度（左上角窗口控件） */
const TRAFFIC_LIGHT_ZONE = 80;

/** 标题栏空白处按下时拖动窗口：仅主键、且 offsetX 在红绿灯区右侧才触发 */
export function dragWindow(offsetX: number, buttons: number) {
  if (buttons === 1 && offsetX > TRAFFIC_LIGHT_ZONE) {
    void getCurrentWindow().startDragging();
  }
}
