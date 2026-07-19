---
name: verify
description: 本仓库的端到端验证方法——构建、启动、驱动 Tauri 应用（主窗口与查看器窗口）并采集证据
---

# photo-browser 验证方法

## 构建与启动

```bash
# 本地 sidecar（一次性）：CI 才下载静态 ffmpeg，本地用 homebrew 软链
ln -sf /opt/homebrew/bin/ffmpeg  src-tauri/binaries/ffmpeg-aarch64-apple-darwin
ln -sf /opt/homebrew/bin/ffprobe src-tauri/binaries/ffprobe-aarch64-apple-darwin

pnpm dev                      # 后台起 vite dev server (1420)，等 curl localhost:1420 返回 200
                              # （工具链是 Vite+：pnpm dev = vp dev、pnpm build = vp check && vp build）
cd src-tauri && cargo build   # debug 二进制
./src-tauri/target/debug/photo-browser                 # 主窗口
./src-tauri/target/debug/photo-browser /path/xx.jpg    # 查看器窗口（argv 模拟"打开方式"，仅 debug 构建）

# 一步到位的替代（已验证）：tauri dev 直接带文件参数，自动起 vite + 编译 + 弹查看器
pnpm tauri dev -- -- /path/xx.jpg
```

RUST_LOG=debug 可看 debug 级日志。日志同时写 `~/Library/Logs/com.fhf.photo-browser-dev/`。

## 驱动与观察（本机无截屏权限）

- `screencapture` 会因屏幕录制权限失败（"could not create image from display"）——别指望截图。
- **辅助功能已授权**：用 `osascript` + System Events 驱动键盘、查窗口：

```applescript
tell application "System Events"
  tell process "photo-browser" to set frontmost to true
  key code 124  -- → 下一张； 123 ←； 51 ⌫ 删除； 53 Esc； keystroke "i" 信息面板
end tell
-- 查窗口数/尺寸：count windows of process "photo-browser"
```

- 窗口内容看不到（WKWebView 不暴露辅助功能树），**证据来源是 tracing 日志**：
  `查看器：取走待打开文件` / `列出同目录媒体 count=N index=I` / `读取文件元数据` / `已移入废纸篓` / `sips 全分辨率转码兜底`。
- 废纸篓验证：`~/.Trash` 读不了（TCC），用
  `osascript -e 'tell application "Finder" to get name of items of trash'`。
- **鼠标点击**：System Events 的 `click at` 报 -25208，用 `cliclick c:x,y`（已 brew 装）；
  hover 效果先 `cliclick m:x,y` 再点。可按 CSS 布局推算按钮坐标点击（如全屏胶囊按钮），
  点击后行为变化（进程退出/日志）即证明元素真实渲染在位。
- **焦点陷阱**：AX 操作（如 set AXFullScreen）或全屏切换后 webview 常丢键盘焦点，
  键盘事件静默丢失≠代码坏了——先 `cliclick` 点一下窗口内容区恢复焦点再发按键。
- **全屏驱动**：`keystroke "f" using {control down, command down}` 进全屏；全屏后
  window 1 变成 1512×33 的标题条（AXUnknown），**内容窗口是 window 2**，查
  `AXFullScreen of window 2`。
- **红绿灯隐藏验证**：`count buttons of window 1` —— viewer 应为 0（objc2 隐藏），
  main 窗口应为 3。自绘窗口按钮坐标：✕ 在 (x+25, y+22)、全屏在 (x+59, y+22)。
- vite 若中途挂掉，之后启动的 app 是空白 webview（一切按键无响应），先 curl 1420 确认。

## 测试素材

用 ffmpeg/sips 生成（放 scratchpad，顺带覆盖 $HOME 之外的 asset scope 动态放行）：

```bash
ffmpeg -f lavfi -i testsrc=size=1920x1080:rate=1 -frames:v 1 photo_2.jpg
ffmpeg -f lavfi -i smptebars=size=1280x960:rate=1 -frames:v 1 photo_10.jpg   # 自然排序应在 photo_2 之后
sips -s format heic 任意.png --out img_heic.heic
ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30:duration=2 -pix_fmt yuv420p clip.mp4
```

## 文件关联（只在 bundle 生效）

```bash
pnpm tauri build   # 产物 src-tauri/target/release/bundle/macos/photo-browser.app
plutil -p .../photo-browser.app/Contents/Info.plist | grep -A5 CFBundleDocumentTypes
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f <app路径>
open -a <app路径> /path/xx.jpg    # 冷启动只应弹查看器；再 open 另一文件测热运行
```

## 坑

- 新窗口 label 必须加进 `src-tauri/capabilities/default.json` 的 `windows`，否则 core 权限（close/事件/拖窗）静默失效。
- `cargo` 命令要在 `src-tauri/` 下跑；联网（拉 crate）需要禁用沙箱。
- prod 与 dev 数据目录隔离（`-dev` 后缀），bundle 测试不会污染 dev 索引。
