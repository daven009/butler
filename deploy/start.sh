#!/bin/sh
set -e

cd /app/backend

# 启动虚拟显示器，让 Playwright 能以 headed 模式启动 Chromium
# （服务器没有真实显示器，Cloudflare Turnstile 自动点击需要 headed）
echo "[start] launching Xvfb on :99 ..."
Xvfb :99 -screen 0 1440x900x24 -nolisten tcp -nolisten unix &
XVFB_PID=$!
export DISPLAY=:99

# 等 Xvfb 真正起来（避免 Chromium 启动早于 X server）
for i in 1 2 3 4 5 6 7 8 9 10; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "[start] Xvfb ready"
    break
  fi
  sleep 0.5
done

cd /app/backend
npx tsx src/server.ts &
BACKEND_PID=$!

cleanup() {
  kill -TERM "$BACKEND_PID" 2>/dev/null || true
  kill -TERM "$XVFB_PID"   2>/dev/null || true
}
trap cleanup INT TERM

nginx -g 'daemon off;' &
NGINX_PID=$!

wait "$NGINX_PID"
