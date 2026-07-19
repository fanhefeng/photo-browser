#!/bin/bash
# 双击运行：修复 macOS 提示「"photo-browser"已损坏，无法打开」的问题。
#
# 原理：本应用未经 Apple 公证签名，浏览器下载的文件会被系统打上
# com.apple.quarantine 隔离属性，新版 macOS 对这类应用直接报"已损坏"
# （文件本身并没有坏）。清除该属性后即可正常打开。

APP="/Applications/photo-browser.app"

echo "照片浏览器 ——「已损坏」修复脚本"
echo

if [ ! -d "$APP" ]; then
  echo "未在「应用程序」中找到 photo-browser。"
  echo "请先把安装窗口左侧的 photo-browser 拖入「应用程序」文件夹，再双击本脚本。"
  echo
  read -n 1 -s -r -p "按任意键退出…"
  echo
  exit 1
fi

if xattr -cr "$APP"; then
  echo "修复完成，现在可以正常打开了。"
  echo
  read -n 1 -s -r -p "按任意键启动照片浏览器…"
  echo
  open "$APP"
else
  echo "清除隔离属性失败。可以打开「终端」手动执行以下命令后重试："
  echo
  echo "  xattr -cr /Applications/photo-browser.app"
  echo
  read -n 1 -s -r -p "按任意键退出…"
  echo
  exit 1
fi
