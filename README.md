# 照片浏览器 (Photo Browser)

一个本地优先的桌面照片/视频浏览器，基于 **Tauri 2 + React + Rust**。打开本地目录，自动解析元数据、生成缩略图并建立索引，支持多维度检索与丝滑大图预览。文件始终留在本机，不上传任何服务器。

## 功能

- **照片 + 视频**：递归扫描，照片识别 JPG/PNG/HEIC/TIFF/WebP 等；视频识别 MP4/MOV/MKV/WebM 等
- **多维度检索**：按类型（照片/视频）、拍摄时间（年）、相机型号、镜头、格式、是否含 GPS 筛选；按文件名搜索
- **分类排序**：按拍摄时间 / 文件名 / 文件大小 / 分辨率 / ISO / 焦距 升降序排列
- **完整元数据详情**：相机、镜头、光圈、快门、ISO、焦距、尺寸、拍摄时间、视频时长、GPS（可一键跳转地图）
- **看图增强**：照片大图支持滚轮缩放（以光标为锚）、双击放大、拖拽平移、缩放工具条（最高 8×）；视频可播放并拖动进度
- **丝滑体验**：虚拟滚动网格（万级不卡）+ 自定义协议缩略图 + 高清预览懒加载与相邻预热
- **增量扫描**：再次打开同一目录只处理新增/改动的文件；扫描可取消，拒绝并发

## 依赖

- **视频功能依赖 `ffmpeg` / `ffprobe`**（封面抽帧 + 元数据）。未安装时照片功能不受影响，应用会顶部提示；安装：`brew install ffmpeg`
- HEIC/HEIF/AVIF 依赖 macOS 自带 `sips`

## 架构

```
前端 (React + Vite，WebView)
  · 目录选择 · 虚拟滚动网格 · 分面筛选 · 大图查看
        │  Tauri IPC + 自定义图片协议 (thumb:// / preview://)
Rust 后端 (src-tauri)
  · walkdir 扫描   · kamadak-exif 解析   · image/sips 缩略图
  · rayon 并行     · rusqlite 索引 (SQLite, WAL)
        │
缓存根目录（随环境/系统而定，见下文「运行环境与目录」）
  ├── index.db      索引数据库
  ├── thumbs/       320px 缩略图（扫描时生成）
  ├── previews/     高分辨率预览（HEIC/TIFF 等懒生成，最长边 3840px）
  └── logs/         运行日志（按天滚动）
```

**关键设计**：扫描一次把元数据写入 SQLite，之后所有筛选/排序都是数据库查询；缩略图通过自定义 URI 协议由 WebView 原生加载，而非 IPC 传 base64——这是性能丝滑的基础。

## 运行环境与目录

派生数据按**用途**分三类目录（遵循各平台规范），并按**环境**（dev/prod）与**系统**隔离，互不污染。

- **环境判定**：`tauri dev`（debug 构建）= **dev**，目录名 `com.fhf.photo-browser-dev`；`tauri build`（release 构建）= **prod**，目录名 `com.fhf.photo-browser`。
- **为什么分三类**：缓存目录会被系统清理（磁盘紧张/优化存储/清理工具）→ 只放可再生的缩略图/预览图；索引库与日志不应被清理 → 放数据目录与日志目录。

### 开发环境 (dev) — `tauri dev`

| 类别 | macOS | Linux | Windows |
|------|-------|-------|---------|
| 数据 `index.db` | `~/Library/Application Support/com.fhf.photo-browser-dev/` | `~/.local/share/com.fhf.photo-browser-dev/` | `%LOCALAPPDATA%\com.fhf.photo-browser-dev\` |
| 缓存 `thumbs/` `previews/` | `~/Library/Caches/com.fhf.photo-browser-dev/` | `~/.cache/com.fhf.photo-browser-dev/` | `%LOCALAPPDATA%\com.fhf.photo-browser-dev\` |
| 日志 `photo-browser.log.<日期>` | `~/Library/Logs/com.fhf.photo-browser-dev/` | `~/.local/share/com.fhf.photo-browser-dev/logs/` | `%LOCALAPPDATA%\com.fhf.photo-browser-dev\logs\` |

### 生产环境 (prod) — `tauri build`

| 类别 | macOS | Linux | Windows |
|------|-------|-------|---------|
| 数据 `index.db` | `~/Library/Application Support/com.fhf.photo-browser/` | `~/.local/share/com.fhf.photo-browser/` | `%LOCALAPPDATA%\com.fhf.photo-browser\` |
| 缓存 `thumbs/` `previews/` | `~/Library/Caches/com.fhf.photo-browser/` | `~/.cache/com.fhf.photo-browser/` | `%LOCALAPPDATA%\com.fhf.photo-browser\` |
| 日志 `photo-browser.log.<日期>` | `~/Library/Logs/com.fhf.photo-browser/` | `~/.local/share/com.fhf.photo-browser/logs/` | `%LOCALAPPDATA%\com.fhf.photo-browser\logs\` |

### 各文件说明

| 文件 | 说明 |
|------|------|
| `index.db` | SQLite 索引库（WAL 模式，运行时另有 `index.db-wal` / `index.db-shm`） |
| `thumbs/<id>.jpg` | 320px 缩略图，扫描时生成（`<id>` 为文件绝对路径的 blake3 哈希） |
| `previews/<id>.jpg` | 高分辨率预览，仅 HEIC/TIFF 等不可直接显示的格式生成（最长边 3840px） |
| `logs/photo-browser.log.<日期>` | 运行日志，按天滚动；dev 级别 `debug`、prod 级别 `info`，可用 `RUST_LOG` 覆盖 |

### 备注

- JPG/PNG/WebP/GIF 等 WebView 可直接解码的格式，大图**直接读原文件**呈现原始清晰度，不生成预览。
- Windows 上数据与缓存同属 `%LOCALAPPDATA%`，靠不同子目录/文件名区分，不会冲突。
- 路径解析（`dirs` crate）跨平台，但部分功能（HEIC 解码用 `sips`、"在访达中显示"用 `open`）目前面向 macOS；Linux/Windows 下数据会落在上表位置，但相关功能需另行适配。
- 运行时实际路径：启动会打印到 DevTools 控制台（含三类目录），或调用 `app_info` 命令获取。
- **历史遗留**：旧版本曾把所有数据混放在 `~/Library/Caches/com.fhf.photo-browser`（macOS），可安全删除：`rm -rf ~/Library/Caches/com.fhf.photo-browser`。

## 开发

```bash
pnpm install
pnpm tauri dev      # 开发模式运行
pnpm tauri build    # 打包成 .app / .dmg
```

## 已知限制

- HEIC/HEIF/AVIF 依赖 macOS 自带的 `sips` 解码（本应用为 macOS 设计）
- 暂未做基于画面内容的 AI 检索（人/物/场景）——可作为后续扩展（接入 CLIP 等视觉模型）
