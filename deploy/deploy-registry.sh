#!/bin/bash
set -euo pipefail

# =====================
# 配置（可通过环境变量覆盖）
# =====================
SERVER_IP="${SERVER_IP:-47.236.98.146}"
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/appointment-scheduler}"
NGINX_CONF_NAME="${NGINX_CONF_NAME:-appointment-scheduler.conf}"

# 例如：docker.io/yourname/appointment-scheduler 或 registry.cn-hangzhou.aliyuncs.com/ns/repo
IMAGE_REPO="${IMAGE_REPO:-}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

if [ -z "${IMAGE_REPO}" ]; then
  echo "❌ 请先设置 IMAGE_REPO，例如："
  echo "   export IMAGE_REPO=docker.io/<your-user>/appointment-scheduler"
  echo "   export IMAGE_TAG=$(date +%Y%m%d-%H%M%S)"
  exit 1
fi

IMAGE_REF="${IMAGE_REPO}:${IMAGE_TAG}"

echo "============================================"
echo "  Appointment Scheduler Registry Deploy"
echo "============================================"
echo "IMAGE_REF=${IMAGE_REF}"

echo "\n📦 Step 1/4: 构建 linux/amd64 镜像..."
docker build --platform linux/amd64 -t "${IMAGE_REF}" .

echo "\n🚀 Step 2/4: 推送镜像到仓库..."
docker push "${IMAGE_REF}"

echo "\n📄 Step 3/4: 上传 compose 与 Nginx 配置..."
ssh "${SERVER_USER}@${SERVER_IP}" "mkdir -p ${REMOTE_DIR}"
scp docker-compose.yml "${SERVER_USER}@${SERVER_IP}:${REMOTE_DIR}/docker-compose.yml"
scp deploy/nginx-host.conf "${SERVER_USER}@${SERVER_IP}:/etc/nginx/conf.d/${NGINX_CONF_NAME}"

echo "\n🔄 Step 4/4: 服务器拉镜像并重启服务..."
ssh "${SERVER_USER}@${SERVER_IP}" <<EOF
set -euo pipefail
cd "${REMOTE_DIR}"
APP_IMAGE="${IMAGE_REF}" docker compose pull
APP_IMAGE="${IMAGE_REF}" docker compose up -d --force-recreate
nginx -t && (systemctl is-active --quiet nginx && systemctl reload nginx || systemctl start nginx)
sleep 8
curl -sf http://127.0.0.1:3080/health >/dev/null && echo "✅ Health check passed"
docker ps --filter name=appointment-scheduler
docker compose logs --tail 50
EOF

echo "\n============================================"
echo "✅ 部署完成: https://${SERVER_IP}"
echo "📌 当前镜像: ${IMAGE_REF}"
echo "============================================"
