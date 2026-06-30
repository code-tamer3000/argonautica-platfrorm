#!/bin/sh
# Self-signed серты для DOMAIN/MEDIA_DOMAIN — для локальной проверки прод-стека.
# В проде заменяются боевыми (Let's Encrypt/certbot) — пути и имена те же.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)/certs"
DOMAIN="${DOMAIN:-localhost}"
MEDIA_DOMAIN="${MEDIA_DOMAIN:-media.localhost}"
mkdir -p "$DIR"
for d in "$DOMAIN" "$MEDIA_DOMAIN"; do
  openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
    -keyout "$DIR/$d.key" -out "$DIR/$d.crt" \
    -subj "/CN=$d" -addext "subjectAltName=DNS:$d" 2>/dev/null
  echo "generated $DIR/$d.crt and $DIR/$d.key"
done
