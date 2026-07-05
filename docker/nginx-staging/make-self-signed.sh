#!/bin/sh
# Self-signed серт для тестового стенда. Один хост по IP — домена нет.
# Запуск при bootstrap стенда (см. шапку docker/deploy-staging.sh):
#   DOMAIN=<IP-стенда> docker/nginx-staging/make-self-signed.sh
# Кладёт <IP>.crt/.key в docker/nginx-staging/certs/ (в git не коммитятся).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)/certs"
DOMAIN="${DOMAIN:-localhost}"
mkdir -p "$DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$DIR/$DOMAIN.key" -out "$DIR/$DOMAIN.crt" \
  -subj "/CN=$DOMAIN" -addext "subjectAltName=IP:$DOMAIN" 2>/dev/null || \
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$DIR/$DOMAIN.key" -out "$DIR/$DOMAIN.crt" \
  -subj "/CN=$DOMAIN" -addext "subjectAltName=DNS:$DOMAIN" 2>/dev/null
echo "generated $DIR/$DOMAIN.crt and $DIR/$DOMAIN.key"
