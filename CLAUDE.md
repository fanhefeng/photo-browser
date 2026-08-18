# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

本地优先的桌面照片/视频浏览器：**Tauri 2 + React 19 + Rust**。打开本地目录 → 扫描解析元数据 → 生成缩略图 → SQLite 建索引 → 多维筛选与大图预览。文件不上传，仅 macOS（HEIC 用 `sips`、视频用 `ffmpeg`/`ffprobe`、"在访达中显示" 用 `open`）。

README.md 含完整的功能/目录布局说明（中文），本文件聚焦需跨文件理解的架构要点。

## 常用命令

```bash
pnpm install
pnpm tauri dev      # 开发运行（debug 构建 = dev 环境，目录后缀 -dev）
pnpm tauri build    # 打包 .app/.dmg（release 构建 = prod 环境）
pnpm build          # 仅前端：vp check（oxlint + tsgolint 类型检查）+ vp build
pnpm exec vp check  # 单跑静态检查（lint + 类型检查；格式化暂关，见 vite.config.ts 的 check.fmt）
```

前端工具链是 **Vite+（vp，VoidZero 全家桶）**：TypeScript 7（原生 Go tsc）、Vite 8（Rolldown + OXC）、oxlint/tsgolint。
配置集中在 `vite.config.ts`（`defineConfig` 从 **vite-plus** 导入，含 `lint`/`check` 块）；
`pnpm-workspace.yaml` 的 overrides 把 `vite` 别名到 `@voidzero-dev/vite-plus-core`——**别删这个文件**（之前删过一次是因为语法写坏，现在是 Vite+ 接线的必要部分）。

```bash
# Rust 单测（src-tauri/src/{db,media,viewer}.rs 内的 #[cfg(test)] 模块）
cd src-tauri && cargo test
cargo test purge_outside_root           # 跑单个测试
cargo clippy                            # lint
```

前端无独立测试框架；`pnpm build` 的 `vp check` 即类型检查关。`RUST_LOG=debug` 可覆盖日志级别。

## 发版：改版本号就够了

```bash
pnpm bump 0.4.2                      # 或 patch / minor / major
git commit -am "chore: bump 0.4.2"
git push
```

`pnpm bump` 是版本号的唯一入口，一次同步四处：`package.json`、`src-tauri/tauri.conf.json`、
`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。**别手改**——CI 会校验四处一致，不一致直接 fail。

push 到 main 后 CI 全自动串起来：

```
package.json 的 version 变化
  → Release：打 tag vX.Y.Z → 构建 dmg（内置 ffmpeg sidecar）→ 发布 Release
    → 构建成功 → Deploy site：部署官网，版本号取自最新 Release
```

关键约束：**官网只在 app 构建成功后才更新**——`release.yml` 的 `deploy-site` job（`needs: release`）
以 `workflow_call` 复用 `deploy-pages.yml`，部署逻辑只有一份。因为官网下载按钮指向
`releases/latest`，抢先部署会让页面显示一个还下载不到的版本号。
纯 `site/**` 改动不受此限，照旧直接部署。

版本号没变的普通提交不会触发发版（`check` job 发现 tag 已存在就跳过）。

**应用内更新（tauri-plugin-updater）**：发版产物额外含 `.app.tar.gz` + `.sig`（minisign 签名）与
`latest.json`（tauri-action 自动生成），端点是 `releases/latest/download/latest.json`（见
`tauri.conf.json` 的 `plugins.updater`）。签名私钥在维护者本机 `~/.tauri/photo-browser-updater.key`
（无密码）+ 仓库 secret `TAURI_SIGNING_PRIVATE_KEY`——**私钥丢失则已装旧版全部无法自动更新**，只能
换公钥重发。前端入口是 `components/UpdateBanner.tsx`（prod 启动 3s 后静默检查 + 原生菜单
「检查更新…」广播 `check-update-requested` 手动触发），检查/下载/验签/替换 `.app` 全在 Rust 侧，
不经浏览器下载所以更新后的 App 不带 quarantine，无需重跑 xattr。dev 下 endpoint 直接打线上库，
自动检查已关（`import.meta.env.PROD`），手动检查在 latest.json 发布前会 404 报「检查失败」属预期。

## 架构要点（非显而易见）

**数据流主轴**：扫描时一次性把所有元数据写进 SQLite，此后**所有筛选/排序都是数据库查询**，前端不持有原始文件句柄。改筛选逻辑通常只动 `db.rs` 的 `build_where` / `sort_column`，不碰扫描。

**缩略图/预览走自定义 URI 协议，不走 IPC**。这是性能丝滑的根本——`thumb://localhost/<id>.jpg` 与 `preview://localhost/<id>.jpg` 由 `lib.rs` 的 `image_protocol()` 注册，WebView 原生加载并缓存图片字节，绝不通过 IPC 传 base64。前端用 `api.ts` 的 `thumbUrl()`/`previewUrl()` 构造这些 URL。原图（JPG/PNG/WebP 等 WebView 可直接解码的）和视频则走 Tauri 内置 `asset:` 协议（`convertFileSrc`），其文件系统作用域在 `tauri.conf.json` 的 `assetProtocol.scope` 限定为 `$HOME/**` 和 `/Volumes/**`。新增任何图片来源都要同步更新 `tauri.conf.json` 的 CSP（`img-src`/`media-src`）。

**两条数据库连接，靠 WAL 并发**：`AppState.db` 是查询用的共享 `Arc<Mutex<Connection>>`（Arc 是为了让 async 命令把连接 clone 进 `spawn_blocking` 闭包）；扫描在 `spawn_blocking` 里用 `db::open()` 开**独立连接**写入。二者靠 SQLite WAL 模式并发读写，所以扫描进行中前端仍可查询。

**`photos` 表同时存照片和视频**——靠 `kind` 列（`'photo'`/`'video'`）区分，这是历史命名，别被表名误导。视频不生成 `preview`（前端直接播原文件），`ensure_preview` 命令对 video 直接返回 false。

**`id` = 文件绝对路径的 blake3 哈希**（`media::media_id`），同时用作缓存文件名 `thumbs/<id>.jpg` / `previews/<id>.jpg`。删除索引时必须连带删这两个缓存文件（见 `scan_impl` 步骤 5），否则缓存目录无限膨胀。

**单目录语义**：每次扫描只保留当前 root 下的索引，`purge_outside_root` 会清掉其他目录的旧记录及缓存。增量扫描靠 `existing_mtimes`（按 root 限定）比对 mtime 跳过未改动文件。

**扫描的并发与取消**：`AppState.scanning`（`AtomicBool`）拒绝并发扫描；`AppState.cancel`（`Arc<AtomicBool>`）在 rayon 并行循环里被轮询。取消时保留已处理部分，但**跳过删除/清理步骤**（扫描不完整，删除不可靠）。进度通过 `scan-progress`/`scan-done` 事件上报，前端在 `App.tsx` 用 `listen` 订阅。

**查看器模式（"打开方式"进入的独立窗口）**：macOS 冷启动双击文件时 `RunEvent::Opened` **先于 setup** 到达（tao 源码确证的时序），所以路径缓冲 `OpenState` 必须用 `Builder::manage` 在 build 阶段注册，`Opened` 回调只 push 缓冲绝不建窗；setup 依据缓冲是否非空决定开 `viewer` 还是 `main` 窗口。前端 `main.tsx` 按窗口 label 分流渲染 `ViewerApp`/`App`。取件用"拉"模型（`take_pending_open` 命令），事件丢失也不丢路径。查看器不依赖索引：`viewer.rs` 的命令全部以路径为中心（`list_siblings` 自然排序、`viewer_item` 元数据、`viewer_trash` 废纸篓+清索引缓存）。HEIC 等先让 WebView 原生解码，`onError` 才走 `viewer_preview`（sips 全分辨率转码到 `cache/viewer/`，由 `vpreview://` 协议服务，与 previews/ 隔离——后者会被扫描与版本迁移随时清掉）。打开的文件目录通过 `asset_protocol_scope().allow_directory` 动态放行（原始 + canonicalize 双份）。**坑：`capabilities/default.json` 的 `windows` 数组必须包含 `"viewer"`**，否则新窗口没有任何 core 权限（`window.close()`、事件监听、拖窗全部静默失效，自定义命令倒是不受 ACL 管所以看起来"半好半坏"）。dev 下文件关联不生效，用 argv 模拟：`target/debug/photo-browser <文件路径>`。查看器窗口是 Quick Look 式深色玻璃 UI：原生红绿灯用 objc2 `standardWindowButton`+`setHidden` 隐藏（`hide_native_window_buttons`，仅 viewer 窗口），关闭/全屏按钮由前端自绘但行为走原生 API（红绿灯样式无公开定制接口，只能隐藏后仿原生）；全屏检测靠 `onResized`→`isFullscreen()`，全屏时顶栏隐藏、底部浮出玻璃胶囊。

## 模块职责

**Rust（`src-tauri/src/`）**
- `lib.rs` — Tauri 入口：`AppState`、查询/预览等 `#[tauri::command]`、自定义图片协议注册、窗口创建、`generate_handler!` 注册所有命令。
- `scan.rs` — 扫描编排 `scan_impl` 与 `scan_directory`/`cancel_scan` 命令（状态仍由 lib.rs 的 `AppState` 持有）。
- `menu.rs` — 原生菜单构建/事件与 `set_locale` 命令。
- `db.rs` — SQLite schema、`query`/`facets`/`upsert_media`/增量与清理逻辑、`Filter`/`Facets` 类型。SQL 注入防护用 `like_escape`。
- `media.rs` — 文件 → `MediaItem`：EXIF 解析（kamadak-exif）、缩略图与预览生成（`image` crate / `sips`）、视频元数据与封面抽帧（`ffprobe`/`ffmpeg`）、EXIF 方向校正、GPS（ISO6709/8601）解析。
- `cache.rs` — 按**环境**（dev/prod，由 `cfg!(debug_assertions)` 判定）与平台隔离的三类目录（数据/缓存/日志）路径解析。
- `viewer.rs` — 查看器命令（同目录列表/元数据/全分辨率转码/移废纸篓），全部以路径为中心、不依赖索引。
- `logging.rs` — `tracing` + 按天滚动日志文件。

**前端（`src/`）**
- `App.tsx` — 顶层状态与编排（目录、筛选、扫描进度、大图索引）；`refresh` 带防抖，扫描完成靠 `reloadKey` 触发重查。
- `api.ts` — 所有 `invoke` 命令封装 + 图片/视频 URL 构造器（与后端命令一一对应）。
- `settings.ts` + `themes.css` — 设置存储（localStorage `settings` 键 + `useSyncExternalStore`）与主题（皮肤）系统：全部主题 token 在 `themes.css` 的 `[data-theme]` 块（light/cream/dark），组件样式只消费变量；`initSettings()` 在 `main.tsx` React 渲染前应用（仅主窗口——查看器窗口固定深色玻璃不换肤，且 `html.viewer-window` 特异性高于 `[data-theme]`）。新增主题 = themes.css 加一块 + `THEMES` 注册一行 + i18n 加 `settings.theme.<id>`。缩略图大小走 `--thumb` 内联覆盖、悬停信息走 `html[data-hover-info]`。
- `types.ts` — `MediaItem`/`Filter`/`Facets`，须与 `db.rs`/`media.rs` 的 serde 结构保持字段一致。
- `ViewerApp.tsx` — 查看器窗口的顶层组件（兄弟列表/键盘/删除/信息面板），与 `App` 互不依赖。
- `components/` — `Toolbar`（筛选/排序/搜索/扫描）、`Sidebar`（分面）、`PhotoGrid`（react-virtuoso 虚拟滚动）、`Lightbox`（大图，懒加载预览 + 相邻预热）、`media.tsx`（Lightbox 与查看器共享的 `VideoStage`/`ZoomBar`/`DetailPanel`）、`SettingsDialog`（设置弹窗：换肤/缩略图大小/悬停信息/语言/自动更新，入口是工具栏与欢迎页齿轮 + 原生菜单「设置…」⌘, 广播 `open-settings`）。
- `hooks/useZoom.ts` — 大图滚轮缩放（以光标为锚）、双击、拖拽平移；`zoomTo` 支持查看器 1:1 绝对缩放（可 <1）。

## 改动时的连带约束

- 新增/改 `MediaItem` 字段：要同步改 `db.rs`（schema + `row_to_item` + `upsert_media` 列）、`types.ts`、可能还有 `media.rs` 的填充逻辑。旧库兼容靠 `init_schema` 里的 `ALTER TABLE ADD COLUMN`（见 `kind`/`duration` 先例）。
- 新增 `#[tauri::command]`：需同时在 `lib.rs` 的 `generate_handler!` 注册 + `api.ts` 加封装。
- 新增筛选维度：`Filter`（db.rs + types.ts）+ `build_where` + 可能的 `facets` + 索引。
