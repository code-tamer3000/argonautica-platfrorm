#!/usr/bin/env bash
# Синхронизация цен тарифов Экспедиции в статический прайс-файл сайта-визитки, чтобы
# 4 карточки на сайте (ExpeditionSection.jsx, отдельный репозиторий) подхватывали
# правки цен из админки платформы без ручной правки сайта или редеплоя. Источник
# истины — таблица `plans` (то же, что читает интейк-бот напрямую из БД, см.
# docs/INTAKE_BOT.md), без HTTP и без публичного API — сайт-контейнер не имеет
# сетевого доступа к платформе, поэтому чтение происходит здесь, на хосте, через
# `docker exec` в контейнер БД, а результат кладётся статическим файлом рядом с
# остальной вёрсткой сайта (тот же volume, что уже смонтирован в nginx:alpine).
#
# Отдаёт ВСЕ тарифы (не только активные) — каждый с price и is_active, чтобы
# сайт мог сам решить, как показать деактивированный тариф (например, «Мест
# нет»), вместо того чтобы карточка просто пропадала без объяснения.
# ВНИМАНИЕ: сайт (ExpeditionSection.jsx, отдельный репозиторий) на момент
# этого изменения ещё ждёт старый формат {"Имя": цена} — его код нужно
# обновить под новую форму отдельно, иначе цены на сайте перестанут читаться.
#
# Ставится в cron на сервере вручную (не часть deploy.sh — сайт и платформа
# развёртываются независимо, см. комментарий в docker/argonautica-site.compose.yml),
# см. docs/DEPLOY.md → Marketing site.
#
# Параметры через env (по умолчанию — прод):
#   PG_CONTAINER  — контейнер Postgres, откуда читать (docker-postgres-1 / platform-staging-postgres-1)
#   SITE_ROOT     — куда писать prices.json (/root/argonautica-site / /root/argonautica-site-preview)
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-docker-postgres-1}"
SITE_ROOT="${SITE_ROOT:-/root/argonautica-site}"

tmp="${SITE_ROOT}/prices.json.tmp"
docker exec "$PG_CONTAINER" psql -U app -d platform -t -A \
  -c "select coalesce(json_object_agg(name, json_build_object('price', price, 'is_active', is_active)), '{}') from plans" \
  > "$tmp"
mv "$tmp" "${SITE_ROOT}/prices.json"
