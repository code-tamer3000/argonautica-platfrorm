#!/usr/bin/env bash
# Онбординг второго потока: набор, «Манифест», копия «64 пути» (стейдж), новость,
# FAQ, приветственные задания. Обёртка вокруг backend/scripts/provision_second_intake.py
# (запускается внутри контейнера бэкенда целевого окружения — DATABASE_URL/MINIO_*
# уже в его env, ничего вручную передавать не нужно).
#
# ВНИМАНИЕ: container-имена ниже — предположение по конвенции проекта
# (docs/DEPLOY.md: прод project=`docker`, стейдж project=`platform-staging`).
# Проверь `ssh $SSH_HOST docker ps` перед первым прогоном и поправь через env,
# если имена другие — скрипт НЕ обнаруживает их сам.
#
#   scripts/provision_second_intake.sh --target staging --starts-on 2026-09-01 --ends-on 2026-09-28
#   scripts/provision_second_intake.sh --target staging ... --allow-placeholders   # черновой текст
#   scripts/provision_second_intake.sh --target prod    --starts-on 2026-09-01 --ends-on 2026-09-28
#
# На --target staging сначала копирует «64 пути» с прода (кросс-контейнерно, тот же
# хост — docker cp через локальную машину); на --target prod этот шаг пропускается
# («64 пути» на проде уже есть, см. Уточнения в задаче).
set -euo pipefail

SSH_HOST=${SSH_HOST:-platform-new}
REMOTE_WORK=${REMOTE_WORK:-/srv/second-intake}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MANIFEST="$HERE/content/manifest.md"

TARGET=""; STARTS_ON=""; ENDS_ON=""; ALLOW_PLACEHOLDERS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)             TARGET="$2"; shift ;;
    --starts-on)          STARTS_ON="$2"; shift ;;
    --ends-on)             ENDS_ON="$2"; shift ;;
    --allow-placeholders) ALLOW_PLACEHOLDERS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
  shift
done

[[ "$TARGET" == "staging" || "$TARGET" == "prod" ]] || { echo "нужен --target staging|prod" >&2; exit 2; }
[[ -n "$STARTS_ON" && -n "$ENDS_ON" ]] || { echo "нужны --starts-on и --ends-on (YYYY-MM-DD)" >&2; exit 2; }
[[ -f "$MANIFEST" ]] || { echo "нет $MANIFEST" >&2; exit 1; }

if [[ "$TARGET" == "prod" ]]; then
  PROJECT=docker
  BACKEND=${PROD_BACKEND_CONTAINER:-docker-backend-blue-1}
else
  PROJECT=platform-staging
  BACKEND=${STAGING_BACKEND_CONTAINER:-platform-staging-backend-1}
  PROD_BACKEND=${PROD_BACKEND_CONTAINER:-docker-backend-blue-1}
fi

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die()  { printf '\033[31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }

ssh -o ConnectTimeout=10 "$SSH_HOST" true || die "нет ssh до $SSH_HOST"
ssh "$SSH_HOST" "docker inspect -f . $BACKEND >/dev/null" \
  || die "на сервере нет контейнера $BACKEND (project=$PROJECT) — проверь имя (docker ps)"

say "Цель: $TARGET (project=$PROJECT, backend=$BACKEND)"
ssh "$SSH_HOST" "mkdir -p $REMOTE_WORK"
scp -q "$MANIFEST" "$SSH_HOST:$REMOTE_WORK/manifest.md"
ssh "$SSH_HOST" "docker cp $REMOTE_WORK/manifest.md $BACKEND:/tmp/manifest.md"

if [[ "$TARGET" == "staging" ]]; then
  say "1/2 «64 пути»: прод → стейдж"
  ssh "$SSH_HOST" "docker inspect -f . $PROD_BACKEND >/dev/null" \
    || die "на сервере нет прод-контейнера $PROD_BACKEND — поправь PROD_BACKEND_CONTAINER"
  ssh "$SSH_HOST" "docker exec -i $PROD_BACKEND python -m scripts.provision_second_intake export-64-puti \
    --out-json /tmp/64-puti.json --out-md /tmp/64-puti.md"
  ssh "$SSH_HOST" "docker cp $PROD_BACKEND:/tmp/64-puti.json $REMOTE_WORK/64-puti.json && \
    docker cp $PROD_BACKEND:/tmp/64-puti.md $REMOTE_WORK/64-puti.md"
  ssh "$SSH_HOST" "docker cp $REMOTE_WORK/64-puti.json $BACKEND:/tmp/64-puti.json && \
    docker cp $REMOTE_WORK/64-puti.md $BACKEND:/tmp/64-puti.md"
  ssh "$SSH_HOST" "docker exec -i $BACKEND python -m scripts.provision_second_intake import-64-puti \
    --in-json /tmp/64-puti.json --in-md /tmp/64-puti.md"
  say "2/2 набор + Манифест + новость + FAQ + задания"
else
  say "«64 пути» — на проде уже существует, шаг копии пропущен"
  say "набор + Манифест + новость + FAQ + задания"
fi

FLAGS=""
(( ALLOW_PLACEHOLDERS )) && FLAGS="--allow-placeholders"
ssh "$SSH_HOST" "docker exec -i $BACKEND python -m scripts.provision_second_intake provision \
  --starts-on $STARTS_ON --ends-on $ENDS_ON --manifest-path /tmp/manifest.md $FLAGS"

info "готово — проверь глазами (набор/статьи/новость/FAQ/задания) в UI $TARGET перед следующим шагом"
