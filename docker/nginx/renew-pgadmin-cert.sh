#!/usr/bin/env bash
# Продление боевого Let's Encrypt серта для db.argonautica-systems.ru (pgAdmin,
# см. docker/nginx/templates/default.conf.template, server_name ${PGADMIN_DOMAIN}, и
# docs/DEPLOY.md → «Наблюдаемость»). Точная копия renew-metrics-cert.sh под другой
# домен/каталог — см. комментарии там для деталей (webroot через :80 прода, certbot
# в контейнере, идемпотентность).
#
# Ставится в cron на сервере при bootstrap:
#   37 3,15 * * * /opt/platform/renew-pgadmin-cert.sh >> /var/log/pgadmin-cert-renew.log 2>&1
set -euo pipefail

SUB=db.argonautica-systems.ru
PROD_DIR=/opt/platform
LE_DIR="$PROD_DIR/letsencrypt-pgadmin"          # изолирован от системного certbot
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
  echo "pgadmin cert renewed and prod nginx recreated"
else
  echo "pgadmin cert not due for renewal"
fi
