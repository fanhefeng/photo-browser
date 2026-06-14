# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本地优先的桌面照片/视频浏览器：**Tauri 2 + React 19 + Rust**。打开本地目录 → 扫描解析元数据 → 生成缩略图 → SQLite 建索引 → 多维筛选与大图预览。文件不上传，仅 macOS（HEIC 用 `sips`、视频用 `ffmpeg`/`ffprobe`、"在访达中显示" 用 `open`）。

README.md 含完整的功能/目录布局说明（中文），本文件聚焦需跨文件理解的架构要点。

## 常用命令

```bash
pnpm install
pnpm tauri dev      # 开发运行（debug 构建 = dev 环境，目录后缀 -dev）
pnpm tauri build    # 打包 .app/.dmg（release 构建 = prod 环境）
pnpm build          # 仅前端：tsc 类型检查 + vite 构建

# Rust 单测（src-tauri/src/{db,media}.rs 内的 #[cfg(test)] 模块）
cd src-tauri && cargo test
cargo test purge_outside_root           # 跑单个测试
cargo clippy                            # lint
```

前端无独立测试框架；`pnpm build` 的 `tsc` 即类型检查关。`RUST_LOG=debug` 可覆盖日志级别。

## 架构要点（非显而易见）

**数据流主轴**：扫描时一次性把所有元数据写进 SQLite，此后**所有筛选/排序都是数据库查询**，前端不持有原始文件句柄。改筛选逻辑通常只动 `db.rs` 的 `build_where` / `sort_column`，不碰扫描。

**缩略图/预览走自定义 URI 协议，不走 IPC**。这是性能丝滑的根本——`thumb://localhost/<id>.jpg` 与 `preview://localhost/<id>.jpg` 由 `lib.rs` 的 `image_protocol()` 注册，WebView 原生加载并缓存图片字节，绝不通过 IPC 传 base64。前端用 `api.ts` 的 `thumbUrl()`/`previewUrl()` 构造这些 URL。原图（JPG/PNG/WebP 等 WebView 可直接解码的）和视频则走 Tauri 内置 `asset:` 协议（`convertFileSrc`），其文件系统作用域在 `tauri.conf.json` 的 `assetProtocol.scope` 限定为 `$HOME/**` 和 `/Volumes/**`。新增任何图片来源都要同步更新 `tauri.conf.json` 的 CSP（`img-src`/`media-src`）。

**两条数据库连接，靠 WAL 并发**：`AppState.db` 是查询用的共享 `Mutex<Connection>`；扫描在 `spawn_blocking` 里用 `db::open()` 开**独立连接**写入。二者靠 SQLite WAL 模式并发读写，所以扫描进行中前端仍可查询。

**`photos` 表同时存照片和视频**——靠 `kind` 列（`'photo'`/`'video'`）区分，这是历史命名，别被表名误导。视频不生成 `preview`（前端直接播原文件），`ensure_preview` 命令对 video 直接返回 false。

**`id` = 文件绝对路径的 blake3 哈希**（`media::media_id`），同时用作缓存文件名 `thumbs/<id>.jpg` / `previews/<id>.jpg`。删除索引时必须连带删这两个缓存文件（见 `scan_impl` 步骤 5），否则缓存目录无限膨胀。

**单目录语义**：每次扫描只保留当前 root 下的索引，`purge_outside_root` 会清掉其他目录的旧记录及缓存。增量扫描靠 `existing_mtimes`（按 root 限定）比对 mtime 跳过未改动文件。

**扫描的并发与取消**：`AppState.scanning`（`AtomicBool`）拒绝并发扫描；`AppState.cancel`（`Arc<AtomicBool>`）在 rayon 并行循环里被轮询。取消时保留已处理部分，但**跳过删除/清理步骤**（扫描不完整，删除不可靠）。进度通过 `scan-progress`/`scan-done` 事件上报，前端在 `App.tsx` 用 `listen` 订阅。

## 模块职责

**Rust（`src-tauri/src/`）**
- `lib.rs` — Tauri 入口：`AppState`、所有 `#[tauri::command]`、自定义图片协议注册、原生菜单、扫描编排 `scan_impl`。
- `db.rs` — SQLite schema、`query`/`facets`/`upsert_media`/增量与清理逻辑、`Filter`/`Facets` 类型。SQL 注入防护用 `like_escape`。
- `media.rs` — 文件 → `MediaItem`：EXIF 解析（kamadak-exif）、缩略图与预览生成（`image` crate / `sips`）、视频元数据与封面抽帧（`ffprobe`/`ffmpeg`）、EXIF 方向校正、GPS（ISO6709/8601）解析。
- `cache.rs` — 按**环境**（dev/prod，由 `cfg!(debug_assertions)` 判定）与平台隔离的三类目录（数据/缓存/日志）路径解析。
- `logging.rs` — `tracing` + 按天滚动日志文件。

**前端（`src/`）**
- `App.tsx` — 顶层状态与编排（目录、筛选、扫描进度、大图索引）；`refresh` 带防抖，扫描完成靠 `reloadKey` 触发重查。
- `api.ts` — 所有 `invoke` 命令封装 + 图片/视频 URL 构造器（与后端命令一一对应）。
- `types.ts` — `MediaItem`/`Filter`/`Facets`，须与 `db.rs`/`media.rs` 的 serde 结构保持字段一致。
- `components/` — `Toolbar`（筛选/排序/搜索/扫描）、`Sidebar`（分面）、`PhotoGrid`（react-virtuoso 虚拟滚动）、`Lightbox`（大图，懒加载预览 + 相邻预热）。
- `hooks/useZoom.ts` — 大图滚轮缩放（以光标为锚）、双击、拖拽平移。

## 改动时的连带约束

- 新增/改 `MediaItem` 字段：要同步改 `db.rs`（schema + `row_to_item` + `upsert_media` 列）、`types.ts`、可能还有 `media.rs` 的填充逻辑。旧库兼容靠 `init_schema` 里的 `ALTER TABLE ADD COLUMN`（见 `kind`/`duration` 先例）。
- 新增 `#[tauri::command]`：需同时在 `lib.rs` 的 `generate_handler!` 注册 + `api.ts` 加封装。
- 新增筛选维度：`Filter`（db.rs + types.ts）+ `build_where` + 可能的 `facets` + 索引。
