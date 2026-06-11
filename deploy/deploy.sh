#!/bin/bash
set -euo pipefail

SERVER_IP="47.236.98.146"
SERVER_USER="admin"
REMOTE_DIR="/opt/appointment-scheduler"
IMAGE_NAME="appointment-scheduler"
CONTAINER_NAME="appointment-scheduler"
NGINX_CONF_NAME="appointment-scheduler.conf"
TAR_FILE="${IMAGE_NAME}.tar.gz"

# Local archive of past builds — useful for quick rollback. We keep the most
# recent KEEP_BUILDS in deploy/dist/ and prune the rest. Each archive is
# named with a UTC timestamp + short git SHA so the order is obvious.
LOCAL_ARCHIVE_DIR="deploy/dist"
KEEP_BUILDS=3
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "nogit")
TS=$(date -u +"%Y%m%d-%H%M%S")
ARCHIVE_NAME="${IMAGE_NAME}-${TS}-${GIT_SHA}.tar.gz"

echo "============================================"
echo "  Appointment Scheduler Deploy"
echo "  build tag: ${TS}-${GIT_SHA}"
echo "============================================"

echo "\n📦 Step 1/5: 构建 Docker 镜像 (linux/amd64)..."
# Vite reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time and
# inlines them into the bundle. They MUST be passed as --build-arg here,
# otherwise the production bundle ships with empty strings and supabase-js
# throws on init → blank white page.
#
# We source them from .env (the same file backend uses at runtime). Note
# the names in .env are SUPABASE_URL / SUPABASE_ANON_KEY (no VITE_ prefix);
# we re-export with the prefix the Dockerfile expects.
if [ ! -f .env ]; then
  echo "❌ .env not found — cannot pass build args to Vite"
  exit 1
fi
# shellcheck disable=SC2046
export $(grep -E '^(SUPABASE_URL|SUPABASE_ANON_KEY)=' .env | xargs)
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  echo "❌ SUPABASE_URL / SUPABASE_ANON_KEY missing in .env"
  exit 1
fi
docker build --platform linux/amd64 \
  --build-arg VITE_SUPABASE_URL="${SUPABASE_URL}" \
  --build-arg VITE_SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}" \
  -t ${IMAGE_NAME}:latest .

echo "\n💾 Step 2/5: 导出镜像 + 归档到 ${LOCAL_ARCHIVE_DIR}/..."
mkdir -p "${LOCAL_ARCHIVE_DIR}"
docker save ${IMAGE_NAME}:latest | gzip > "${TAR_FILE}"
SIZE=$(du -h "${TAR_FILE}" | cut -f1)
# Archive a copy locally for rollback. We hardlink instead of copy when
# possible (same FS) to avoid doubling disk usage.
cp -f "${TAR_FILE}" "${LOCAL_ARCHIVE_DIR}/${ARCHIVE_NAME}"
echo "✅ 镜像已导出: ${TAR_FILE} (${SIZE})"
echo "✅ 归档: ${LOCAL_ARCHIVE_DIR}/${ARCHIVE_NAME}"
# Prune old archives (keep newest KEEP_BUILDS).
ls -1t "${LOCAL_ARCHIVE_DIR}"/${IMAGE_NAME}-*.tar.gz 2>/dev/null \
  | tail -n +$((KEEP_BUILDS + 1)) \
  | xargs -r rm -v

echo "\n🚀 Step 3/5: 上传部署文件 (远端只保留运行所需，每次部署直接覆盖)..."
ssh ${SERVER_USER}@${SERVER_IP} "sudo mkdir -p ${REMOTE_DIR}"
scp "${TAR_FILE}" ${SERVER_USER}@${SERVER_IP}:~/
scp docker-compose.yml ${SERVER_USER}@${SERVER_IP}:~/
scp deploy/nginx-host.conf ${SERVER_USER}@${SERVER_IP}:~/nginx-host.conf
if [ -f .env ]; then
  scp .env ${SERVER_USER}@${SERVER_IP}:~/.env
fi
ssh ${SERVER_USER}@${SERVER_IP} "sudo mv ~/${TAR_FILE} ${REMOTE_DIR}/ && sudo mv ~/docker-compose.yml ${REMOTE_DIR}/ && sudo mv ~/nginx-host.conf /etc/nginx/conf.d/${NGINX_CONF_NAME} && if [ -f ~/.env ]; then sudo mv ~/.env ${REMOTE_DIR}/.env; fi"

echo "\n🔄 Step 4/5: 远端启动服务 + 清理上一版镜像/tar..."
ssh ${SERVER_USER}@${SERVER_IP} << ENDSSH
set -e
cd ${REMOTE_DIR}
sudo docker load < ${TAR_FILE}
sudo docker compose down 2>/dev/null || true
sudo docker compose up -d
# Drop the just-loaded tar — the image now lives in /var/lib/docker.
sudo rm -f ${REMOTE_DIR}/${TAR_FILE}
# Drop dangling images from the previous deploy (the old <none>:<none>
# layers left over after `docker load` overwrites the :latest tag).
sudo docker image prune -f >/dev/null 2>&1 || true
sudo nginx -t && (sudo systemctl is-active --quiet nginx && sudo systemctl reload nginx || sudo systemctl start nginx)
sleep 8
if curl -sf http://127.0.0.1:3080/health > /dev/null 2>&1; then
  echo "✅ Health check passed"
else
  echo "⚠️ Health check failed, logs:"
  sudo docker compose logs --tail 80
fi
ENDSSH

# Local cleanup: drop the working copy now that the archive lives in
# deploy/dist/ for rollback.
rm -f "${TAR_FILE}"

echo "\n🔎 Step 5/5: 部署结果检查"
ssh ${SERVER_USER}@${SERVER_IP} "sudo docker ps --filter name=${CONTAINER_NAME} && echo '---' && sudo docker compose -f ${REMOTE_DIR}/docker-compose.yml logs --tail 20 && echo '---DISK---' && df -h /"

echo "\n============================================"
echo "✅ 部署完成"
echo "🌐 https://app.hey-alfred.vip"
echo "📦 本地归档: ${LOCAL_ARCHIVE_DIR}/${ARCHIVE_NAME}"
echo "↩️  回滚: bash deploy/rollback.sh <archive-name>"
echo "============================================"
