#!/usr/bin/env bash
# Blue-green деплой (zero-downtime). Запускать из любого места — сам перейдёт в корень.
#
# Шаги: собрать образ → миграции (expand, ДО переключения) → поднять целевой цвет →
# дождаться healthy → переключить upstream nginx → reload → дренаж WS → стоп старого.
# Откат: вернуть active_backend.conf на старый цвет, `nginx -s reload`, поднять его.
set -euo pipefail

cd "$(dirname "$0")/.."                       # корень репо
COMPOSE_FILE="docker/docker-compose.prod.yml"
ACTIVE_CONF="docker/nginx/active_backend.conf"
ENV_FILE=".env"
DRAIN_SECONDS="${DRAIN_SECONDS:-15}"

# Детект compose v2 / v1.
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi
DC="$DC -f $COMPOSE_FILE --env-file $ENV_FILE"

# Активный цвет — из upstream-конфига.
if grep -q backend-green "$ACTIVE_CONF"; then
  CURRENT=green; TARGET=blue
else
  CURRENT=blue; TARGET=green
fi
echo ">> active=$CURRENT, deploying → $TARGET"

# 1. Свежие образы: backend (общий platform-backend:latest для обоих цветов) + frontend
#    (в его образ впечён npm-build SPA — без пересборки прод показывал бы старый UI).
$DC build "backend-$TARGET" frontend

# 2. Миграции expand/contract ДО переключения (совместимы с живым $CURRENT).
$DC run --rm migrate

# 3. Поднять целевой цвет на новом образе.
$DC up -d --no-deps "backend-$TARGET"

# 4. Дождаться healthy.
CID="$($DC ps -q "backend-$TARGET")"
echo ">> ожидаем healthy backend-$TARGET ($CID)"
status=starting
for _ in $(seq 1 30); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo starting)"
  [ "$status" = healthy ] && break
  sleep 2
done
if [ "$status" != healthy ]; then
  echo "!! backend-$TARGET не стал healthy — отмена, трафик остаётся на $CURRENT" >&2
  exit 1
fi

# 5. Переключить upstream + reload nginx (без даунтайма).
sed -i "s/backend-$CURRENT:8000/backend-$TARGET:8000/" "$ACTIVE_CONF"
$DC exec -T nginx nginx -s reload
echo ">> трафик переключён → backend-$TARGET"

# 6. Обновить frontend-контейнер на свежесобранном образе. Статика, пересоздание
#    занимает доли секунды; nginx проксирует по имени сервиса `frontend` → подхватит.
$DC up -d --no-deps frontend

# 7. Дренаж WS (клиент реконнектится) и остановка старого цвета.
sleep "$DRAIN_SECONDS"
$DC stop "backend-$CURRENT"
echo ">> готово. Откат: вернуть $ACTIVE_CONF на backend-$CURRENT, nginx -s reload, поднять его."
