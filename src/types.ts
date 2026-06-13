// 与 Rust 后端结构体一一对应的类型定义

export interface Photo {
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

export interface FacetItem {
  value: string;
  count: number;
}

export interface Facets {
  total: number;
  kinds: FacetItem[];
  years: FacetItem[];
  cameras: FacetItem[];
  lenses: FacetItem[];
  formats: FacetItem[];
  with_gps: number;
}

export interface Filter {
  root?: string;
  text?: string;
  years: number[];
  cameras: string[];
  lenses: string[];
  formats: string[];
  kinds: string[];
  has_gps: boolean;
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
  years: [],
  cameras: [],
  lenses: [],
  formats: [],
  kinds: [],
  has_gps: false,
  sort_by: "taken_at",
  sort_dir: "desc",
});
