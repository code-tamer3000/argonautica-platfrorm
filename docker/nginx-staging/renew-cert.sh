#!/usr/bin/env bash
# Продление боевого Let's Encrypt серта стенда (staging.argonautica-systems.ru) и
# доставка его в nginx стенда.
#
# Почему не системный certbot: хостовый certbot (v0.40) сломан (несовместимость
# pyOpenSSL/cryptography), поэтому гоняем certbot В КОНТЕЙНЕРЕ (certbot/certbot).
# Challenge — webroot ЧЕРЕЗ :80 ПРОДА: прод-nginx отдаёт /.well-known/acme-challenge/
# из общего docker-тома `docker_certbot_webroot`, а туда его кладёт этот же контейнер.
# Так серт стенда выпускается/продлевается, не трогая конфиг прода и без DNS-API.
#
# Идемпотентно: `renew` реально обновляет серт только когда до истечения < 30 дней.
# При обновлении deploy-hook копирует свежий серт, а мы кладём его в каталог сертов
# стенда и ПЕРЕСОЗДАЁМ nginx стенда (envsubst re-render на старте перечитает файл;
# `restart` бы НЕ перечитал — см. deploy-staging.sh).
#
# Ставится в cron на сервере при bootstrap (см. docs/DEPLOY.md → «Тестовый стенд»):
#   17 3,15 * * * /opt/platform-staging/renew-staging-cert.sh >> /var/log/staging-cert-renew.log 2>&1
# Копия скрипта живёт в репо (этот файл) как источник правды; на сервер кладётся как
# /opt/platform-staging/renew-staging-cert.sh. Прод не затрагивается.
set -euo pipefail

SUB=staging.argonautica-systems.ru
STAGING_DIR=/opt/platform-staging
LE_DIR="$STAGING_DIR/letsencrypt"                    # изолирован от системного certbot
CERTS_DIR="$STAGING_DIR/docker/nginx-staging/certs"  # монтируется в nginx стенда (ro)

docker run --rm \
  -v docker_certbot_webroot:/var/www/certbot \
  -v "$LE_DIR":/etc/letsencrypt \
  certbot/certbot renew --webroot -w /var/www/certbot \
  --deploy-hook "cp -L /etc/letsencrypt/live/$SUB/fullchain.pem /etc/letsencrypt/deployed.crt && cp -L /etc/letsencrypt/live/$SUB/privkey.pem /etc/letsencrypt/deployed.key"

# deployed.* появляются только если renew реально обновил серт в этот прогон.
if [ -f "$LE_DIR/deployed.crt" ]; then
  install -m 644 "$LE_DIR/deployed.crt" "$CERTS_DIR/$SUB.crt"
  install -m 600 "$LE_DIR/deployed.key" "$CERTS_DIR/$SUB.key"
  rm -f "$LE_DIR/deployed.crt" "$LE_DIR/deployed.key"
  cd "$STAGING_DIR"
  docker compose -p platform-staging -f docker/docker-compose.staging.yml --env-file .env \
    up -d --force-recreate --no-deps nginx
  echo "staging cert renewed and nginx recreated"
else
  echo "staging cert not due for renewal"
fi
