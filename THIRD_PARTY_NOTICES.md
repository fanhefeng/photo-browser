# Third-party software / 第三方软件说明

Photo Browser 自有代码采用仓库 `LICENSE` 的 MIT 许可；下列独立工具与其库保留自己的许可。本说明描述新的源码构建方案，不对旧版发布包作追溯合规保证。

## FFmpeg / ffprobe: LGPL-2.1-or-later

FFmpeg Copyright (c) 2000–2026 the FFmpeg developers. 本项目通过独立进程调用 FFmpeg/ffprobe，不链接其库到 Photo Browser。两工具从 FFmpeg 官方 9.0.2 完整源码构建，不启用 GPL/nonfree 组件。构建禁用自动外部依赖和网络协议，保留本地视频解码、元数据读取及 JPEG 封面功能。

- 源码：https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz
- SHA-256：`8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`
- 该源码的官方 PGP 签名已验证，签名密钥指纹：`FCF986EA15E6E293A5644F10B4322F04D67658D8`（与 https://ffmpeg.org/download.html 公布值一致）。
- 完整许可：[licenses/LGPL-2.1.txt](licenses/LGPL-2.1.txt)
- 官方许可说明：https://ffmpeg.org/legal.html

## dav1d: BSD-2-Clause

Copyright © 2018–2025, VideoLAN and dav1d authors. 为保留 AV1 软件解码能力，静态链接由官方 1.5.4 源码构建的 dav1d。

- 源码：https://download.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz
- SHA-256：`686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5`（已对照官方 SHA-256 文件）
- 完整许可与版权：[licenses/dav1d-COPYING.txt](licenses/dav1d-COPYING.txt)

其余动态链接项仅使用 macOS 系统库/框架，包括系统 zlib、VideoToolbox 和 AudioToolbox。构建脚本拒绝非系统 dylib 依赖。

## 对应源码获取与重建

每个采用此方案的 GitHub Release 必须在发布安装包前附带 **`photo-browser-ffmpeg-sources.tar.gz`**：

https://github.com/fanhefeng/photo-browser/releases

该存档包含确切完整 FFmpeg/dav1d 源码压缩包、构建脚本、许可和构建记录，以及 pkgconf 构建工具源码。请下载与安装包同一版本 Release 下的源码附件；不需要只依靠可能变化的上游链接。CI 先创建草稿，只有源码附件上传成功才公开 Release。

在 Apple Silicon macOS 上解包源码附件后，执行 `bash scripts/build-ffmpeg-source.sh`。需要 Xcode Command Line Tools、Python 3、make；Meson 1.9.1 与 Ninja 1.13.0 安装于构建目录的隔离 Python 环境。脚本优先复用附件提供的源码，不修改系统开发环境。构建记录保留编译器/系统版本；不承诺不同 SDK 或编译器下逐字节相同。

pkgconf 2.5.1 仅为构建工具，不随应用运行：源码 https://distfiles.ariadne.space/pkgconf/pkgconf-2.5.1.tar.xz ，SHA-256 `cd05c9589b9f86ecf044c10a2269822bc9eb001eced2582cfffd658b0a50c243`；许可见 [licenses/pkgconf-COPYING.txt](licenses/pkgconf-COPYING.txt)。

## 旧版构建历史

旧版使用 Martin Riedl 的 FFmpeg 9.0 静态成品，启用 GPLv3。`licenses/GPL-3.0.txt` 和 `licenses/ffmpeg-build-versions.txt` 保留该历史构建说明；它们不是新源码构建的有效许可声明。此前固定成品构建的完整对应源码映射尚未核实，新方案不解决旧版已有分发的追溯问题。
