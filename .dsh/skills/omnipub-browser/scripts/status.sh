#!/usr/bin/env bash
# omnipub-browser 状态检查：CDP / 扩展 / 页面 / 登录态
# 用法: bash .dsh/skills/omnipub-browser/scripts/status.sh [port]
set -euo pipefail
PORT="${1:-9222}"

if ! curl -s --max-time 2 "http://localhost:$PORT/json/version" >/dev/null 2>&1; then
  echo "browser: DOWN"
  exit 1
fi
curl -s "http://localhost:$PORT/json/version" | python3 -c 'import sys,json; print("browser:", json.load(sys.stdin).get("Browser"))'
python3 - "$PORT" <<'PYEOF'
import json, sys, urllib.request
port = sys.argv[1]
targets = json.load(urllib.request.urlopen(f"http://localhost:{port}/json/list", timeout=5))
ext = sum(1 for t in targets if "chrome-extension" in (t.get("url") or ""))
pages = [t for t in targets if t.get("type") == "page"]
if ext > 0:
    print(f"extension_targets={ext}")
else:
    print("extension_targets=0 (MV3 SW 休眠属正常，从 Omnipub 页面 ping 扩展即可唤醒)")
omni = next((t for t in pages if "localhost:3000" in (t.get("url") or "")), None)
print("omnipub_page:", (omni.get("url") or "none")[:60] if omni else "none (用 /json/new 打开一个)")
for t in pages[:6]:
    if "localhost" not in (t.get("url") or ""):
        print("  tab:", (t.get("url") or "")[:70])
PYEOF
