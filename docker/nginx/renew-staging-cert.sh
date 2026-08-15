#!/usr/bin/env bash
# Продление боевого Let's Encrypt серта стенда (staging.argonautica-systems.ru) и
# доставка его в ПРОД-nginx (тот самый, что теперь терминирует TLS для поддомена
# стенда — см. docker/nginx/templates/default.conf.template, server_name
# ${STAGING_DOMAIN}, и docs/DEPLOY.md → Staging). Живёт в docker/nginx/, а не
# docker/nginx-staging/, потому что после переезда на общий шлюз именно прод-nginx
# держит сертификат стенда — staging-nginx TLS больше не терминирует.
#
# Почему не системный certbot: хостовый certbot (v0.40) сломан (несовместимость
# pyOpenSSL/cryptography), поэтому гоняем certbot В КОНТЕЙНЕРЕ (certbot/certbot).
# Challenge — webroot ЧЕРЕЗ :80 ПРОДА: прод-nginx отдаёт /.well-known/acme-challenge/
# из общего docker-тома `docker_certbot_webroot`, а туда его кладёт этот же контейнер.
# Так серт стенда выпускается/продлевается, не трогая остальной конфиг прода и без DNS-API.
#
# Идемпотентно: `renew` реально обновляет серт только когда до истечения < 30 дней.
# При обновлении deploy-hook копирует свежий серт в каталог сертов ПРОДА и пересоздаёт
# ПРОД-nginx (envsubst re-render на старте перечитает файл; `restart` бы НЕ перечитал —
# см. docker/deploy.sh / docs/DEPLOY.md «deploy.sh не доводит nginx-правки до конца»).
#
# Ставится в cron на сервере при bootstrap (см. docs/DEPLOY.md → «Тестовый стенд»):
#   17 3,15 * * * /opt/platform/renew-staging-cert.sh >> /var/log/staging-cert-renew.log 2>&1
# Копия скрипта живёт в репо (этот файл) как источник правды; на сервер кладётся как
# /opt/platform/renew-staging-cert.sh (в дереве ПРОДА, не /opt/platform-staging).
set -euo pipefail

SUB=staging.argonautica-systems.ru
PROD_DIR=/opt/platform
LE_DIR="$PROD_DIR/letsencrypt-staging"          # изолирован от системного certbot
CERTS_DIR="$PROD_DIR/docker/nginx/certs"        # монтируется в прод-nginx (ro)

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
  cd "$PROD_DIR"
  docker compose -p docker -f docker/docker-compose.prod.yml --env-file .env \
    up -d --force-recreate --no-deps nginx
  echo "staging cert renewed and prod nginx recreated"
else
  echo "staging cert not due for renewal"
fi
