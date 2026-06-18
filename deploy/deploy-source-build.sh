#!/bin/bash
set -euo pipefail

# =====================
# 配置（可通过环境变量覆盖）
# =====================
SERVER_IP="${SERVER_IP:-47.236.98.146}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/appointment-scheduler}"
REMOTE_SRC_DIR="${REMOTE_DIR}/src"
NGINX_CONF_NAME="${NGINX_CONF_NAME:-appointment-scheduler.conf}"
IMAGE_NAME="${IMAGE_NAME:-appointment-scheduler}"
SRC_TAR="/tmp/appointment-src.tar.gz"

echo "============================================"
echo "  Appointment Scheduler Source Deploy"
echo "============================================"

# Sanity check: .env must exist locally — it carries SUPABASE_URL/ANON_KEY which
# Vite needs at build time (baked into the JS bundle), and the backend needs at
# runtime. Without it, the front-end will show "Missing VITE_SUPABASE_URL".
if [ ! -f .env ]; then
  echo "❌ Local .env not found. Create one (copy backend/.env) before deploying."
  echo "   The script ships it to ${REMOTE_DIR}/.env on the server so docker compose"
  echo "   can read SUPABASE_URL etc. for both build args and runtime env."
  exit 1
fi

echo -e "\n📦 Step 1/5: 打包源码（排除大文件）..."
rm -f "${SRC_TAR}"
LC_ALL=C COPYFILE_DISABLE=1 tar --no-xattrs -czf "${SRC_TAR}" \
  --exclude='./.git' \
  --exclude='./.DS_Store' \
  --exclude='./.codebuddy' \
  --exclude='./.env' \
  --exclude='./.logs' \
  --exclude='./.npm-cache' \
  --exclude='./node_modules' \
  --exclude='./deploy/dist' \
  --exclude='./backend/.DS_Store' \
  --exclude='./backend/.env' \
  --exclude='./backend/.logs' \
  --exclude='./backend/.playwright' \
  --exclude='./backend/dist' \
  --exclude='./web/node_modules' \
  --exclude='./web/.git' \
  --exclude='./web/.DS_Store' \
  --exclude='./web/.env.local' \
  --exclude='./web/.playwright-cli' \
  --exclude='./web/dist' \
  --exclude='./backend/node_modules' \
  --exclude='./debug_video' \
  --exclude='./appointment-scheduler.tar.gz' \
  --exclude='./_archive_*' \
  --exclude='./_recovered' \
  .
ls -lh "${SRC_TAR}"

echo -e "\n🚀 Step 2/5: 上传源码包到服务器..."
ssh "${SERVER_USER}@${SERVER_IP}" "mkdir -p ${REMOTE_DIR}"
if ! scp "${SRC_TAR}" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/"; then
  echo "scp 失败，回退 dd+ssh 直传..."
  dd if="${SRC_TAR}" bs=4m status=progress | ssh "${SERVER_USER}@${SERVER_IP}" "cat > ${REMOTE_DIR}/$(basename "${SRC_TAR}")"
fi

echo -e "\n📄 Step 3/5: 同步部署配置 + .env 到服务器..."
scp docker-compose.yml "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/docker-compose.yml"
scp .env "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/.env"
scp deploy/nginx-host.conf "${SERVER_USER}@${SERVER_IP}:/etc/nginx/conf.d/${NGINX_CONF_NAME}"

echo -e "\n🔧 Step 4/5: 服务器解压源码、build (用 docker compose build 注入 build.args)、重启..."
ssh "${SERVER_USER}@${SERVER_IP}" <<EOF
set -euo pipefail
mkdir -p "${REMOTE_SRC_DIR}"
rm -rf "${REMOTE_SRC_DIR:?}"/*
tar -xzf "${REMOTE_DIR}/$(basename "${SRC_TAR}")" -C "${REMOTE_SRC_DIR}"

# docker-compose 需要 .env 在构建目录里才能读 build.args 中的 \${SUPABASE_URL} 等。
# 同时让 docker-compose.yml 也在构建目录里（compose build 默认在当前目录找 Dockerfile）。
cp "${REMOTE_DIR}/.env" "${REMOTE_SRC_DIR}/.env"
cp "${REMOTE_DIR}/docker-compose.yml" "${REMOTE_SRC_DIR}/docker-compose.yml"

# 关键：用 docker compose build（不是 docker build）才能把 docker-compose.yml
# 里的 build.args（VITE_SUPABASE_URL 等）注入 Dockerfile 的 ARG 里，从而把 env
# 烧进 vite 打出来的前端 bundle。
cd "${REMOTE_SRC_DIR}"
set -a; source .env; set +a
APP_IMAGE="${IMAGE_NAME}:latest" docker compose build

# 用编译好的 image 在 ${REMOTE_DIR} 启动（用统一 compose volume 命名空间，避免冲突）。
cd "${REMOTE_DIR}"
set -a; source .env; set +a
APP_IMAGE="${IMAGE_NAME}:latest" docker compose up -d --force-recreate

nginx -t && (systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx)
sleep 8
curl -sf http://127.0.0.1:3080/health >/dev/null && echo "✅ Health check passed"
docker ps --filter name=appointment-scheduler
docker compose logs --tail 60
EOF

echo -e "\n🧹 Step 5/5: 清理本地临时包..."
rm -f "${SRC_TAR}"

echo -e "\n============================================"
echo "✅ 部署完成: https://${SERVER_IP}"
echo "============================================"
