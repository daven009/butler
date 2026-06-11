#!/bin/bash
# Roll back to a previously archived build.
#
# Usage:
#   bash deploy/rollback.sh                       # list available archives
#   bash deploy/rollback.sh <archive-name>        # roll back to that archive
#   bash deploy/rollback.sh latest                # roll back to most recent
#
# Archives live in deploy/dist/ and are produced by deploy.sh. Each archive
# is a `docker save | gzip` of the appointment-scheduler:latest image at
# the time of that deploy. Rolling back loads it on the remote host and
# restarts the compose stack — no rebuild needed.

set -euo pipefail

SERVER_IP="47.236.98.146"
SERVER_USER="admin"
REMOTE_DIR="/opt/appointment-scheduler"
IMAGE_NAME="appointment-scheduler"
CONTAINER_NAME="appointment-scheduler"
LOCAL_ARCHIVE_DIR="deploy/dist"

if [ ! -d "${LOCAL_ARCHIVE_DIR}" ]; then
  echo "❌ No archive directory at ${LOCAL_ARCHIVE_DIR}/. Run a deploy first."
  exit 1
fi

list_archives() {
  echo "📦 Available archives in ${LOCAL_ARCHIVE_DIR}/ (newest first):"
  ls -1t "${LOCAL_ARCHIVE_DIR}"/${IMAGE_NAME}-*.tar.gz 2>/dev/null | while read -r f; do
    sz=$(du -h "$f" | cut -f1)
    printf "  %s  (%s)\n" "$(basename "$f")" "$sz"
  done
}

if [ $# -eq 0 ]; then
  list_archives
  echo ""
  echo "Run: bash deploy/rollback.sh <archive-name>  or  bash deploy/rollback.sh latest"
  exit 0
fi

if [ "$1" = "latest" ]; then
  ARCHIVE=$(ls -1t "${LOCAL_ARCHIVE_DIR}"/${IMAGE_NAME}-*.tar.gz 2>/dev/null | head -n 1)
  if [ -z "${ARCHIVE}" ]; then
    echo "❌ No archives found."
    exit 1
  fi
else
  # Accept either bare name or full path
  if [ -f "${LOCAL_ARCHIVE_DIR}/$1" ]; then
    ARCHIVE="${LOCAL_ARCHIVE_DIR}/$1"
  elif [ -f "$1" ]; then
    ARCHIVE="$1"
  else
    echo "❌ Archive not found: $1"
    list_archives
    exit 1
  fi
fi

echo "↩️  Rolling back to: $(basename "${ARCHIVE}")"
SIZE=$(du -h "${ARCHIVE}" | cut -f1)
echo "   size: ${SIZE}"

# Stage on remote, load, restart.
TMP_NAME="rollback-$(date +%s).tar.gz"
scp "${ARCHIVE}" ${SERVER_USER}@${SERVER_IP}:~/${TMP_NAME}
ssh ${SERVER_USER}@${SERVER_IP} << ENDSSH
set -e
sudo mv ~/${TMP_NAME} ${REMOTE_DIR}/${TMP_NAME}
cd ${REMOTE_DIR}
sudo docker load < ${TMP_NAME}
sudo docker compose down 2>/dev/null || true
sudo docker compose up -d
sudo rm -f ${REMOTE_DIR}/${TMP_NAME}
sudo docker image prune -f >/dev/null 2>&1 || true
sleep 5
if curl -sf http://127.0.0.1:3080/health > /dev/null 2>&1; then
  echo "✅ Rollback healthy"
else
  echo "⚠️ Health check failed:"
  sudo docker compose logs --tail 60
fi
ENDSSH

echo ""
echo "============================================"
echo "✅ 回滚完成"
echo "🌐 https://app.hey-alfred.vip"
echo "============================================"
