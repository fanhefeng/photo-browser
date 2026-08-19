// 对 Tauri 后端命令与自定义图片协议的封装

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { Facets, Filter, MediaItem, QueryResult } from "./types";

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

export function queryPhotos(filter: Filter): Promise<QueryResult> {
  return invoke<QueryResult>("query_photos", { filter });
}

export function getFacets(root?: string): Promise<Facets> {
  return invoke<Facets>("get_facets", { root: root ?? null });
}

/** 同一 id 的在途请求合并为一次调用：Lightbox 每次导航会为当前图与相邻
 *  预热重复请求同一张，不合并则同一张图被并发解码多次（并发上限见后端信号量）。 */
const previewInflight = new Map<string, Promise<boolean>>();

export function ensurePreview(id: string): Promise<boolean> {
  let p = previewInflight.get(id);
  if (!p) {
    p = invoke<boolean>("ensure_preview", { id }).finally(() => {
      previewInflight.delete(id);
    });
    previewInflight.set(id, p);
  }
  return p;
}

export function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

/** 在系统默认浏览器打开外部链接。WebView 里 target="_blank" 不会有任何反应
 *  （Tauri 未注册新窗口处理器），外链一律走这里。 */
export function openExternal(url: string): Promise<void> {
  return invoke("open_external", { url });
}

/** 通知后端当前语言（zh/en），用于重建原生菜单的文案 */
export function setLocale(lang: string): Promise<void> {
  return invoke("set_locale", { lang });
}

// —— 查看器模式（"打开方式"进入的独立窗口）——

/** 同目录兄弟文件的轻量条目 */
export interface SiblingItem {
  path: string;
  filename: string;
  ext: string;
  kind: "photo" | "video";
}

export interface Siblings {
  items: SiblingItem[];
  /** 打开的文件在 items 中的下标 */
  index: number;
}

/** 取走并清空"待打开文件"缓冲（挂载时与收到 viewer-open-pending 事件时调用） */
export function takePendingOpen(): Promise<string[]> {
  return invoke<string[]>("take_pending_open");
}

/** 列出同目录全部媒体文件（按文件名自然排序）及当前文件下标 */
export function listSiblings(path: string): Promise<Siblings> {
  return invoke<Siblings>("list_siblings", { path });
}

/** 单个文件的完整元数据（信息面板用），不依赖索引 */
export function viewerItem(path: string): Promise<MediaItem> {
  return invoke<MediaItem>("viewer_item", { path });
}

/** WebView 无法原生解码时的兜底：全分辨率转 JPEG，返回缓存 id */
export function viewerPreview(path: string): Promise<string> {
  return invoke<string>("viewer_preview", { path });
}

/** 移入废纸篓（同时清理索引与缩略图/预览缓存） */
export function viewerTrash(path: string): Promise<void> {
  return invoke("viewer_trash", { path });
}

/** 查看器全分辨率转码缓存 URL */
export const vpreviewUrl = (id: string) => `vpreview://localhost/${id}.jpg`;

/** 缩略图 URL（自定义协议，WebView 原生加载/缓存）。
 *  id = 路径哈希，文件内容变了 URL 不变——协议层带 1 年强缓存，
 *  必须用 mtime 做版本参数，文件更新后才能击穿缓存拿到重建的缩略图。 */
export const thumbUrl = (id: string, mtime: number) =>
  `thumb://localhost/${id}.jpg?v=${mtime}`;

/** 大图预览 URL（需先调用 ensurePreview 生成）。版本参数同 thumbUrl。 */
export const previewUrl = (id: string, mtime: number) =>
  `preview://localhost/${id}.jpg?v=${mtime}`;

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
