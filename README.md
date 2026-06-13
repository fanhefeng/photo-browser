# 照片浏览器 (Photo Browser)

一个本地优先的桌面照片浏览器，基于 **Tauri 2 + React + Rust**。打开本地目录，自动解析 EXIF、生成缩略图并建立索引，支持多维度检索与丝滑大图预览。照片始终留在本机，不上传任何服务器。

## 功能

- **打开本地目录**：递归扫描，自动识别 JPG/PNG/HEIC/TIFF/WebP 等格式
- **多维度检索**：按拍摄时间（年）、相机型号、镜头、文件格式、是否含 GPS 定位筛选；按文件名搜索
- **分类排序**：按拍摄时间 / 文件名 / 文件大小 / 分辨率 / ISO / 焦距 升降序排列
- **完整 EXIF 详情**：相机、镜头、光圈、快门、ISO、焦距、尺寸、拍摄时间、GPS（可一键跳转地图）
- **丝滑体验**：虚拟滚动网格（万级照片不卡）+ 自定义协议缩略图 + 高清预览懒加载与相邻预热
- **增量扫描**：再次打开同一目录只处理新增/改动的文件

## 架构

```
前端 (React + Vite，WebView)
  · 目录选择 · 虚拟滚动网格 · 分面筛选 · 大图查看
        │  Tauri IPC + 自定义图片协议 (thumb:// / preview://)
Rust 后端 (src-tauri)
  · walkdir 扫描   · kamadak-exif 解析   · image/sips 缩略图
  · rayon 并行     · rusqlite 索引 (SQLite, WAL)
        │
缓存目录: ~/Library/Caches/com.fhf.photo-browser/
  ├── index.db      索引数据库
  ├── thumbs/       320px 缩略图（扫描时生成）
  └── previews/     1920px 预览图（打开大图时懒生成）
```

**关键设计**：扫描一次把元数据写入 SQLite，之后所有筛选/排序都是数据库查询；缩略图通过自定义 URI 协议由 WebView 原生加载，而非 IPC 传 base64——这是性能丝滑的基础。

## 开发

```bash
pnpm install
pnpm tauri dev      # 开发模式运行
pnpm tauri build    # 打包成 .app / .dmg
```

## 已知限制

- HEIC/HEIF/AVIF 依赖 macOS 自带的 `sips` 解码（本应用为 macOS 设计）
- 暂未做基于画面内容的 AI 检索（人/物/场景）——可作为后续扩展（接入 CLIP 等视觉模型）
