#!/usr/bin/env bash
# Продление боевого Let's Encrypt серта для metrics.argonautica-systems.ru (Grafana,
# см. docker/nginx/templates/default.conf.template, server_name ${METRICS_DOMAIN}, и
# docs/DEPLOY.md → «Наблюдаемость»). Точная копия renew-staging-cert.sh под другой
# домен/каталог — см. комментарии там для деталей (webroot через :80 прода, certbot
# в контейнере, идемпотентность).
#
# Ставится в cron на сервере при bootstrap:
#   23 3,15 * * * /opt/platform/renew-metrics-cert.sh >> /var/log/metrics-cert-renew.log 2>&1
set -euo pipefail

SUB=metrics.argonautica-systems.ru
PROD_DIR=/opt/platform
LE_DIR="$PROD_DIR/letsencrypt-metrics"          # изолирован от системного certbot
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
  echo "metrics cert renewed and prod nginx recreated"
else
  echo "metrics cert not due for renewal"
fi
