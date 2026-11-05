#!/usr/bin/env bash
# omnipub-browser 启动脚本：幂等启动带 Omnipub 扩展的 Chrome for Testing
# 用法: bash .dsh/skills/omnipub-browser/scripts/launch.sh [port] [open_url]
#   port 默认 9222；open_url 默认 http://localhost:3000/articles
#
# 设计要点（改动前先读）：
# - 用 setsid 守护化：从 DSH 前台 bash 调用也不会随命令结束被进程组回收
#   （前台 `cmd &` 的进程会被整组杀掉，这是实测坑，勿改回普通 `&`）
# - 浏览器二进制用 frontend 项目 playwright 锁定的构建（版本与 profile 硬耦合）
# - profile 只许升级打开：降级会 SIGTRAP 崩溃

set -euo pipefail

PORT="${1:-9222}"
OPEN_URL="${2:-http://localhost:3000/articles}"
REPO="/Users/addo/Workspaces/private_w/omnipub"
PROFILE="$HOME/.omnipub-test-profile"
CFT="/Users/addo/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"

# 0. 幂等：已在运行则直接报状态
if curl -s --max-time 2 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
  echo "ALREADY_RUNNING port=$PORT"
  curl -s --max-time 2 "http://localhost:$PORT/json/version" | python3 -c 'import sys,json; print("browser:", json.load(sys.stdin).get("Browser"))'
  exit 0
fi

# 1. 前置检查
if [ ! -x "$CFT" ]; then
  echo "ERROR: CfT 二进制不存在（Playwright 缓存可能被其他项目清掉了）"
  echo "恢复: cd $REPO/frontend && npx playwright install chromium"
  exit 1
fi
if ! curl -s --max-time 3 http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "WARN: Omnipub 服务未运行（docker compose up -d），页面会打开但无法登录"
fi

# 2. 清理残留锁（上次异常退出遗留会阻止启动）
rm -f "$PROFILE"/Singleton* 2>/dev/null || true

# 3. 守护化启动（脱离调用方进程组；stderr 留日志便于排查）
#    macOS 无 setsid，用「子壳双 fork + nohup」等效脱离；Linux/有 setsid 时优先用
LOG=/tmp/omnipub-browser.log
CFT_ARGS=( \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --disable-extensions-except="$REPO/extension" \
  --load-extension="$REPO/extension" \
  --no-first-run \
  --disable-session-crashed-bubble \
  --hide-crash-restore-bubble \
  "$OPEN_URL" )
if command -v setsid >/dev/null 2>&1; then
  setsid nohup "$CFT" "${CFT_ARGS[@]}" >>"$LOG" 2>&1 < /dev/null &
else
  ( nohup "$CFT" "${CFT_ARGS[@]}" >>"$LOG" 2>&1 < /dev/null & )
fi
echo "launched log=$LOG"

# 4. 等待 CDP 端口就绪（正常 2~5s，冷启动可达 60s）
for i in $(seq 1 30); do
  sleep 2
  if curl -s --max-time 2 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
    echo "STARTED port=$PORT after $((i*2))s"
    curl -s "http://localhost:$PORT/json/version" | python3 -c 'import sys,json; print("browser:", json.load(sys.stdin).get("Browser"))'
    # 扩展 target 验证
    EXT=$(curl -s --max-time 3 "http://localhost:$PORT/json/list" | python3 -c '
import sys, json
try:
    ts = json.load(sys.stdin)
    print(sum(1 for t in ts if "chrome-extension" in (t.get("url") or "")))
except Exception:
    print(-1)')
    echo "extension_targets=$EXT"
    [ "$EXT" -gt 0 ] 2>/dev/null || echo "WARN: 扩展未加载，检查 $REPO/extension 目录"
    exit 0
  fi
  # 进程都没了则提前失败（如 profile 降级崩溃）
  pgrep -f "remote-debugging-port=$PORT" >/dev/null || { echo "ERROR: 浏览器进程启动即退出（profile 降级崩溃？见 skill 文档恢复章节）"; exit 1; }
done
echo "ERROR: CDP 端口 60s 内未就绪"
exit 1
