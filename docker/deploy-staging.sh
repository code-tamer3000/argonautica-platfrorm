#!/usr/bin/env bash
# Деплой тестового стенда (staging) из ветки develop. Без blue-green — стенду не нужен
# zero-downtime: собрать образы → миграции → поднять. Полностью изолирован от прода
# (отдельный compose-проект platform-staging, свои volume'ы/сеть/порты).
#
# --- Одноразовый BOOTSTRAP на сервере (до первого CI-деплоя) ---
#   1. mkdir -p /opt/platform-staging   (или первый прогон workflow создаст каталог rsync-ом)
#   2. Создать /opt/platform-staging/.env из .env.staging.example: подставить <IP> стенда,
#      сгенерить свои POSTGRES_*/MINIO_*/JWT_SECRET (openssl rand -hex 32). TELEGRAM_BOT_TOKEN
#      оставить ПУСТЫМ (стенд бота не поднимает).
#   3. Серт:   DOMAIN=<IP> docker/nginx-staging/make-self-signed.sh
#   4. Пароль: htpasswd -bc docker/nginx-staging/staging.htpasswd <user> <pass>
#   5. Открыть 8443/tcp в firewall/security-group хостинга.
#   6. Первый подъём (дальше — автоматически этим скриптом из CI):
#        cd /opt/platform-staging && bash docker/deploy-staging.sh
# Ручные команды к стенду — всегда с `-p platform-staging`, напр.:
#   docker compose -p platform-staging -f docker/docker-compose.staging.yml --env-file .env logs -f
# Дальше деплой автоматический — этот скрипт из .github/workflows/deploy-staging.yml.
set -euo pipefail

cd "$(dirname "$0")/.."                        # корень репо
COMPOSE_FILE="docker/docker-compose.staging.yml"
ENV_FILE=".env"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi
# -p platform-staging — изоляция от прод-проекта (свои контейнеры/сеть/volume'ы),
# не зависит от CWD и версии compose (top-level `name:` не поддерживается v1).
DC="$DC -p platform-staging -f $COMPOSE_FILE --env-file $ENV_FILE"

echo ">> staging: сборка образов (backend + frontend)"
$DC build backend frontend

echo ">> staging: миграции (alembic upgrade head)"
$DC run --rm migrate

echo ">> staging: подъём стенда"
$DC up -d

echo ">> staging: готово. Доступ: https://<IP>:8443 (за Basic Auth)."
