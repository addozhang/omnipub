#!/usr/bin/env bash
# omnipub-browser 关闭脚本：关闭浏览器前先检查是否有依赖它的后台任务
# 用法: bash .dsh/skills/omnipub-browser/scripts/stop.sh [port] [--force]
#
# 默认安全模式：发现疑似依赖浏览器的工作痕迹（发布进行中的编辑器 tab）时提示。
# --force 跳过检查直接关。
set -euo pipefail
PORT="${1:-9222}"
FORCE="${2:-}"

if ! pgrep -f "remote-debugging-port=$PORT" >/dev/null; then
  echo "browser: 已经是关闭状态"
  exit 0
fi

if [ "$FORCE" != "--force" ]; then
  # 检查是否有发布编辑器 tab 残留（关闭可能中断进行中的发布）
  EDITORS=$(curl -s --max-time 3 "http://localhost:$PORT/json/list" 2>/dev/null | python3 -c '
import sys, json
try:
    ts = json.load(sys.stdin)
    pats = ("upload/text/new-edit", "article/write", "graphic/publish", "blogger/publish", "/write", "ai-write")
    print(sum(1 for t in ts if t.get("type") == "page" and any(p in (t.get("url") or "") for p in pats)))
except Exception:
    print(0)' || echo 0)
  if [ "${EDITORS:-0}" -gt 0 ]; then
    echo "WARN: 检测到 $EDITORS 个发布编辑器 tab 可能有发布进行中"
    echo "确认无碍后执行: $0 $PORT --force"
    exit 2
  fi
fi

pkill -f "remote-debugging-port=$PORT"
for i in $(seq 1 10); do
  sleep 1
  pgrep -f "remote-debugging-port=$PORT" >/dev/null || { echo "STOPPED"; exit 0; }
done
pkill -9 -f "remote-debugging-port=$PORT" 2>/dev/null || true
sleep 1
pgrep -f "remote-debugging-port=$PORT" >/dev/null && echo "WARN: 进程仍在" || echo "STOPPED"
