#!/bin/sh
set -e

# Container entrypoint. Used to launch Xvfb + Chromium for the server-side
# Playwright scraper, but that flow has been retired (the browser extension
# now does PG scraping client-side and POSTs to /api/.../import-from-extension).
# This script now just starts the backend + nginx.

cd /app/backend
npx tsx src/server.ts &
BACKEND_PID=$!

cleanup() {
  kill -TERM "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup INT TERM

nginx -g 'daemon off;' &
NGINX_PID=$!

wait "$NGINX_PID"
