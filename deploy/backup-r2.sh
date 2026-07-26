#!/bin/bash
# Backup TRIOSMART hằng đêm lên R2 ksss-backups (giữ 30 ngày) — chạy bởi cron 02:10
set -euo pipefail
STAMP=$(date +%Y%m%d_%H%M%S)
OUT=/root/triosmart/backups/triosmart_${STAMP}.sql.gz
mkdir -p /root/triosmart/backups
docker exec trio-postgres pg_dump -U trio -d triosmart | gzip > "$OUT"
MC_CONFIG_DIR=/root/.mc mc cp "$OUT" "r2/ksss-backups/triosmart/triosmart_${STAMP}.sql.gz"
# Dọn local >7 ngày và R2 >30 ngày
find /root/triosmart/backups -name '*.sql.gz' -mtime +7 -delete
MC_CONFIG_DIR=/root/.mc mc rm --recursive --force --older-than 30d "r2/ksss-backups/triosmart/" 2>/dev/null || true
echo "[backup-r2] OK $OUT"
