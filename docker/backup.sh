#!/usr/bin/env bash
# Резервное копирование PostgreSQL → MinIO (bucket: backups).
#
# Cron: 0 3 * * * /path/to/docker/backup.sh >> /var/log/backup.log 2>&1
#
# Зависимости: docker (compose plugin), gzip, mc (MinIO client) или python3+boto3.
# Перед первым запуском настроить алиас mc:
#   mc alias set minio "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

set -euo pipefail

# ---------------------------------------------------------------------------
# Конфиг из env (дефолты совпадают с .env.example)
# ---------------------------------------------------------------------------
POSTGRES_USER="${POSTGRES_USER:-app}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-change_me}"
POSTGRES_DB="${POSTGRES_DB:-platform}"

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-change_me_too}"

BUCKET="backups"
COMPOSE_FILE="$(dirname "$(realpath "$0")")/docker-compose.prod.yml"
BACKUP_FILE="/tmp/backup_$(date +%Y-%m-%d_%H).sql.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ---------------------------------------------------------------------------
# 1. Найти контейнер postgres динамически
# ---------------------------------------------------------------------------
log "Получаю ID контейнера postgres..."
POSTGRES_CONTAINER=$(docker compose -f "$COMPOSE_FILE" ps -q postgres 2>/dev/null | head -1)

if [[ -z "$POSTGRES_CONTAINER" ]]; then
  log "ОШИБКА: контейнер postgres не найден. Стек запущен?"
  exit 1
fi
log "Контейнер: $POSTGRES_CONTAINER"

# ---------------------------------------------------------------------------
# 2. pg_dump → gzip → файл
# ---------------------------------------------------------------------------
log "Дамп базы '$POSTGRES_DB' → $BACKUP_FILE ..."
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Дамп готов: $BACKUP_FILE ($BACKUP_SIZE)"

# ---------------------------------------------------------------------------
# 3. Загрузить в MinIO
# ---------------------------------------------------------------------------
OBJECT_KEY="$(basename "$BACKUP_FILE")"

upload_via_mc() {
  log "Загружаю через mc: $OBJECT_KEY → minio/$BUCKET/ ..."
  # Убедиться что bucket существует
  mc mb --ignore-existing "minio/$BUCKET"
  mc cp "$BACKUP_FILE" "minio/$BUCKET/$OBJECT_KEY"
}

upload_via_boto3() {
  log "mc не найден, загружаю через python3+boto3..."
  python3 - <<PYEOF
import boto3, sys

s3 = boto3.client(
    "s3",
    endpoint_url="${MINIO_ENDPOINT}",
    aws_access_key_id="${MINIO_ROOT_USER}",
    aws_secret_access_key="${MINIO_ROOT_PASSWORD}",
)
bucket = "${BUCKET}"
key = "${OBJECT_KEY}"
backup_file = "${BACKUP_FILE}"

# Создать bucket если не существует
existing = [b["Name"] for b in s3.list_buckets()["Buckets"]]
if bucket not in existing:
    s3.create_bucket(Bucket=bucket)
    print(f"Bucket '{bucket}' создан.")

s3.upload_file(backup_file, bucket, key)
print(f"Загружено: s3://{bucket}/{key}")
PYEOF
}

if command -v mc &>/dev/null; then
  upload_via_mc
else
  upload_via_boto3
fi

# ---------------------------------------------------------------------------
# 4. Удалить бэкапы старше 30 дней из bucket
# ---------------------------------------------------------------------------
log "Удаляю бэкапы старше 30 дней из $BUCKET ..."

if command -v mc &>/dev/null; then
  mc rm --recursive --force --older-than 30d "minio/$BUCKET/" || true
else
  python3 - <<PYEOF
import boto3
from datetime import datetime, timezone, timedelta

s3 = boto3.client(
    "s3",
    endpoint_url="${MINIO_ENDPOINT}",
    aws_access_key_id="${MINIO_ROOT_USER}",
    aws_secret_access_key="${MINIO_ROOT_PASSWORD}",
)
bucket = "${BUCKET}"
cutoff = datetime.now(timezone.utc) - timedelta(days=30)

paginator = s3.get_paginator("list_objects_v2")
deleted = 0
for page in paginator.paginate(Bucket=bucket):
    for obj in page.get("Contents", []):
        if obj["LastModified"] < cutoff:
            s3.delete_object(Bucket=bucket, Key=obj["Key"])
            print(f"Удалён: {obj['Key']}")
            deleted += 1

print(f"Итого удалено: {deleted} объектов.")
PYEOF
fi

# ---------------------------------------------------------------------------
# 5. Убрать локальный временный файл
# ---------------------------------------------------------------------------
rm -f "$BACKUP_FILE"
log "Временный файл удалён: $BACKUP_FILE"

log "Резервное копирование завершено успешно."
