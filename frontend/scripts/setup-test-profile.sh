#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-test-profile.sh — 首次设置 Omnipub 真实发布测试的 Chrome Profile
#
# 用途：
#   打开 Playwright 自带的 Chromium（Chrome for Testing），加载 Omnipub 扩展，
#   用户手动登录各平台后关闭即可。
#   登录状态保存在专用 Profile 目录中，不影响日常 Chrome 使用。
#
# 注意：
#   Chrome 137+ 的品牌版（Google Chrome）已移除 --load-extension 支持，
#   因此必须使用 Playwright 自带的 Chromium（unbranded），该版本仍支持此功能。
#
# 环境变量：
#   OMNIPUB_TEST_PROFILE — Profile 目录 (默认: ~/.omnipub-test-profile)
#   OMNIPUB_EXT_PATH     — 扩展源码路径 (默认: 自动检测 ../../extension)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROFILE_DIR="${OMNIPUB_TEST_PROFILE:-$HOME/.omnipub-test-profile}"
EXT_PATH="${OMNIPUB_EXT_PATH:-$(cd "$(dirname "$0")/../../extension" && pwd)}"

# Find Playwright's bundled Chromium (Chrome for Testing)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROMIUM_PATH=""

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS: look in Playwright cache
  PW_CACHE="$HOME/Library/Caches/ms-playwright"
  CHROMIUM_DIR=$(ls -d "$PW_CACHE"/chromium-* 2>/dev/null | sort -V | tail -1)
  if [ -n "$CHROMIUM_DIR" ]; then
    CHROMIUM_PATH="$CHROMIUM_DIR/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    if [ ! -f "$CHROMIUM_PATH" ]; then
      # Try x64 path
      CHROMIUM_PATH="$CHROMIUM_DIR/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    fi
  fi
elif [[ "$OSTYPE" == "linux"* ]]; then
  PW_CACHE="$HOME/.cache/ms-playwright"
  CHROMIUM_DIR=$(ls -d "$PW_CACHE"/chromium-* 2>/dev/null | sort -V | tail -1)
  if [ -n "$CHROMIUM_DIR" ]; then
    CHROMIUM_PATH="$CHROMIUM_DIR/chrome-linux/chrome"
  fi
fi

if [ -z "$CHROMIUM_PATH" ] || [ ! -f "$CHROMIUM_PATH" ]; then
  echo "❌ Playwright 的 Chromium 未找到。请先运行："
  echo "   cd frontend && npx playwright install chromium"
  echo ""
  echo "   Chrome 137+ 品牌版已移除 --load-extension 支持，"
  echo "   必须使用 Playwright 自带的 Chromium。"
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  Omnipub Test Profile Setup"
echo "═══════════════════════════════════════════════════"
echo ""
echo "📁 Profile 目录: $PROFILE_DIR"
echo "🧩 扩展路径:     $EXT_PATH"
echo "🌐 浏览器:       $CHROMIUM_PATH"
echo ""
echo "Chromium 将会打开，请："
echo "  1. 在各平台网站上登录（掘金、CSDN、知乎等）"
echo "  2. 确认 Omnipub 扩展已加载（点击扩展图标检查）"
echo "  3. 登录完成后关闭浏览器窗口"
echo ""

# Verify extension directory exists
if [ ! -d "$EXT_PATH" ]; then
  echo "❌ 扩展目录不存在: $EXT_PATH"
  exit 1
fi

# Create profile directory if needed
mkdir -p "$PROFILE_DIR"

echo "🚀 启动 Chromium..."
echo ""

"$CHROMIUM_PATH" \
  --user-data-dir="$PROFILE_DIR" \
  --disable-extensions-except="$EXT_PATH" \
  --load-extension="$EXT_PATH" \
  --no-first-run \
  --no-default-browser-check \
  --use-mock-keychain \
  "https://juejin.cn/login" \
  "https://passport.csdn.net/login" \
  "https://www.zhihu.com/signin"

echo ""
echo "✅ Chromium 已关闭。登录状态已保存到: $PROFILE_DIR"
echo "   现在可以运行: npm run test:real"
