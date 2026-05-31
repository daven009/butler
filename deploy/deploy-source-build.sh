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

echo "\n📦 Step 1/5: 打包源码（排除大文件）..."
rm -f "${SRC_TAR}"
tar -czf "${SRC_TAR}" \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./web/node_modules' \
  --exclude='./backend/node_modules' \
  --exclude='./debug_video' \
  --exclude='./appointment-scheduler.tar.gz' \
  --exclude='./.codebuddy' \
  .
ls -lh "${SRC_TAR}"

echo "\n🚀 Step 2/5: 上传源码包到服务器..."
if ! scp "${SRC_TAR}" "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/"; then
  echo "scp 失败，回退 dd+ssh 直传..."
  dd if="${SRC_TAR}" bs=4m status=progress | ssh "${SERVER_USER}@${SERVER_IP}" "cat > ${REMOTE_DIR}/$(basename "${SRC_TAR}")"
fi

echo "\n📄 Step 3/5: 同步部署配置到服务器..."
ssh "${SERVER_USER}@${SERVER_IP}" "mkdir -p ${REMOTE_DIR}"
scp docker-compose.yml "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/docker-compose.yml"
scp deploy/nginx-host.conf "${SERVER_USER}@${SERVER_IP}:/etc/nginx/conf.d/${NGINX_CONF_NAME}"

echo "\n🔧 Step 4/5: 服务器构建镜像并重启服务..."
ssh "${SERVER_USER}@${SERVER_IP}" <<EOF
set -euo pipefail
mkdir -p "${REMOTE_SRC_DIR}"
rm -rf "${REMOTE_SRC_DIR:?}"/*
tar -xzf "${REMOTE_DIR}/$(basename "${SRC_TAR}")" -C "${REMOTE_SRC_DIR}"
cd "${REMOTE_SRC_DIR}"

docker build --platform linux/amd64 -t "${IMAGE_NAME}:latest" .
cd "${REMOTE_DIR}"
APP_IMAGE="${IMAGE_NAME}:latest" docker compose up -d --force-recreate
nginx -t && (systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx)
sleep 8
curl -sf http://127.0.0.1:3080/health >/dev/null && echo "✅ Health check passed"
docker ps --filter name=appointment-scheduler
docker compose logs --tail 60
EOF

echo "\n🧹 Step 5/5: 清理本地临时包..."
rm -f "${SRC_TAR}"

echo "\n============================================"
echo "✅ 部署完成: https://${SERVER_IP}"
echo "============================================"
