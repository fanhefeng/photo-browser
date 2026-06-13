// 对 Tauri 后端命令与自定义图片协议的封装

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Facets, Filter, Photo } from "./types";

/** 弹出系统目录选择框，返回所选目录（取消返回 null） */
export async function pickDirectory(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

/** 扫描目录并建立索引；进度通过 scan-progress / scan-done 事件上报 */
export function scanDirectory(path: string): Promise<number> {
  return invoke<number>("scan_directory", { path });
}

export function queryPhotos(filter: Filter): Promise<Photo[]> {
  return invoke<Photo[]>("query_photos", { filter });
}

export function getFacets(root?: string): Promise<Facets> {
  return invoke<Facets>("get_facets", { root: root ?? null });
}

export function getPhoto(id: string): Promise<Photo | null> {
  return invoke<Photo | null>("get_photo", { id });
}

export function ensurePreview(id: string): Promise<boolean> {
  return invoke<boolean>("ensure_preview", { id });
}

export function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

/** 缩略图 URL（自定义协议，WebView 原生加载/缓存） */
export const thumbUrl = (id: string) => `thumb://localhost/${id}.jpg`;

/** 大图预览 URL（需先调用 ensurePreview 生成） */
export const previewUrl = (id: string) => `preview://localhost/${id}.jpg`;

/** 视频原始文件 URL（走 Tauri asset 协议，支持 Range 拖动进度） */
export const videoSrc = (path: string) => convertFileSrc(path);
