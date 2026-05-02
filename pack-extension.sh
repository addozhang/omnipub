#!/usr/bin/env bash
# pack-extension.sh — 打包 Chrome 扩展为 .zip
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"
OUT_DIR="$SCRIPT_DIR/dist"

# 读取版本号
VERSION=$(python3 -c "import json; print(json.load(open('$EXT_DIR/manifest.json'))['version'])")
ZIP_NAME="omnipub-extension-v${VERSION}.zip"

mkdir -p "$OUT_DIR"

echo "📦 打包 Chrome 扩展 v${VERSION}..."

cd "$EXT_DIR"
zip -r "$OUT_DIR/$ZIP_NAME" . \
  --exclude "*.DS_Store" \
  --exclude "__pycache__/*" \
  --exclude "*.map" \
  --exclude ".git/*" \
  --exclude "node_modules/*" \
  --exclude "package-lock.json" \
  --exclude "eslint.config.js" \
  --exclude "package.json"

echo "✅ 打包完成: dist/$ZIP_NAME"
echo "   大小: $(du -sh "$OUT_DIR/$ZIP_NAME" | cut -f1)"
