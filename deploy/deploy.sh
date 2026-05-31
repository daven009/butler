#!/bin/bash
set -euo pipefail

SERVER_IP="47.236.98.146"
SERVER_USER="admin"
REMOTE_DIR="/opt/appointment-scheduler"
IMAGE_NAME="appointment-scheduler"
CONTAINER_NAME="appointment-scheduler"
NGINX_CONF_NAME="appointment-scheduler.conf"
TAR_FILE="${IMAGE_NAME}.tar.gz"

echo "============================================"
echo "  Appointment Scheduler Deploy"
echo "============================================"

echo "\n🧹 Step 0/5: 清理旧 CRM 应用..."
ssh ${SERVER_USER}@${SERVER_IP} "sudo docker compose -f /opt/relateai-crm/docker-compose.yml down 2>/dev/null || true; sudo docker rm -f relateai-crm 2>/dev/null || true; sudo docker rmi relateai-crm:latest 2>/dev/null || true; sudo rm -f /etc/nginx/conf.d/relateai-crm.conf; sudo rm -rf /opt/relateai-crm; sudo nginx -t && sudo systemctl reload nginx"

echo "\n📦 Step 1/5: 构建 Docker 镜像 (linux/amd64)..."
docker build --platform linux/amd64 -t ${IMAGE_NAME}:latest .

echo "\n💾 Step 2/5: 导出镜像..."
docker save ${IMAGE_NAME}:latest | gzip > ${TAR_FILE}
SIZE=$(du -h ${TAR_FILE} | cut -f1)
echo "✅ 镜像已导出: ${TAR_FILE} (${SIZE})"

echo "\n🚀 Step 3/5: 上传部署文件..."
ssh ${SERVER_USER}@${SERVER_IP} "sudo mkdir -p ${REMOTE_DIR}"
scp ${TAR_FILE} ${SERVER_USER}@${SERVER_IP}:~/
scp docker-compose.yml ${SERVER_USER}@${SERVER_IP}:~/
scp deploy/nginx-host.conf ${SERVER_USER}@${SERVER_IP}:~/nginx-host.conf
if [ -f .env ]; then
  scp .env ${SERVER_USER}@${SERVER_IP}:~/.env
fi
ssh ${SERVER_USER}@${SERVER_IP} "sudo mv ~/${TAR_FILE} ${REMOTE_DIR}/ && sudo mv ~/docker-compose.yml ${REMOTE_DIR}/ && sudo mv ~/nginx-host.conf /etc/nginx/conf.d/${NGINX_CONF_NAME} && if [ -f ~/.env ]; then sudo mv ~/.env ${REMOTE_DIR}/.env; fi"

echo "\n🔄 Step 4/5: 远端启动服务..."
ssh ${SERVER_USER}@${SERVER_IP} << ENDSSH
set -e
cd ${REMOTE_DIR}
sudo docker load < ${TAR_FILE}
sudo docker compose down 2>/dev/null || true
sudo docker compose up -d
rm -f ${TAR_FILE}
sudo nginx -t && (sudo systemctl is-active --quiet nginx && sudo systemctl reload nginx || sudo systemctl start nginx)
sleep 8
if curl -sf http://127.0.0.1:3080/health > /dev/null 2>&1; then
  echo "✅ Health check passed"
else
  echo "⚠️ Health check failed, logs:"
  sudo docker compose logs --tail 80
fi
ENDSSH

rm -f ${TAR_FILE}

echo "\n🔎 Step 5/5: 部署结果检查"
ssh ${SERVER_USER}@${SERVER_IP} "sudo docker ps --filter name=${CONTAINER_NAME} && echo '---' && sudo docker compose -f ${REMOTE_DIR}/docker-compose.yml logs --tail 20"

echo "\n============================================"
echo "✅ 部署完成: https://${SERVER_IP}"
echo "⚠️ 首次访问需信任自签名证书"
echo "============================================"
