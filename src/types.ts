// 与 Rust 后端结构体一一对应的类型定义

export interface MediaItem {
  id: string;
  path: string;
  filename: string;
  dir: string;
  ext: string;
  kind: "photo" | "video";
  file_size: number;
  mtime: number;
  width: number | null;
  height: number | null;
  duration: number | null; // 视频时长，秒
  taken_at: number | null; // Unix 秒
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  iso: number | null;
  aperture: number | null;
  shutter: string | null;
  focal_length: number | null;
  gps_lat: number | null;
  gps_lon: number | null;
  orientation: number | null;
}

/** 一个分类项：稳定 key（用于过滤）+ 展示标签 + 数量 */
export interface FacetItem {
  key: string;
  label: string;
  count: number;
}

/** 一个分组维度：维度标识 + 标题 + 其下各分类 */
export interface FacetGroup {
  dim: string;
  title: string;
  items: FacetItem[];
}

export interface Facets {
  total: number;
  groups: FacetGroup[];
}

export interface Filter {
  root?: string;
  text?: string;
  /** 当前“分组查看”所选维度（kind/year/camera/focal/iso/format/gps）；全局单选 */
  group_dim?: string;
  /** 该维度下所选分类 key（如 "2024" / "wide" / "unknown"） */
  group_key?: string;
  sort_by: SortBy;
  sort_dir: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export type SortBy =
  | "taken_at"
  | "filename"
  | "file_size"
  | "width"
  | "iso"
  | "focal_length"
  | "mtime";

export const emptyFilter = (): Filter => ({
  sort_by: "taken_at",
  sort_dir: "desc",
});
