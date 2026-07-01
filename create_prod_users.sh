#!/usr/bin/env bash
# Прод: массово создать аккаунты участников из users.md и сохранить логины/пароли.
#
# Логин = Telegram-ник без '@'. Пароль одноразовый (argon2 необратим) — единственная
# копия попадёт в файл вывода credentials_*.txt. Раздайте участникам и УДАЛИТЕ файл.
# Идемпотентно: уже заведённые логины пропускаются.
#
# Использование (из корня репо на проде, где поднят стек):
#   ./create_prod_users.sh              # берёт ./users.md
#   ./create_prod_users.sh path/to.md   # другой файл со списком ников
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Docker Compose v2 (прод) / v1 — на всякий случай.
if docker compose version &>/dev/null 2>&1; then
    DC=(docker compose)
elif command -v docker-compose &>/dev/null; then
    DC=(docker-compose)
else
    echo "docker compose не найден" >&2
    exit 1
fi

CF="docker/docker-compose.prod.yml"
USERS_FILE="${1:-users.md}"
OUT="credentials_$(date +%Y%m%d_%H%M%S).txt"

[ -f "$CF" ] || { echo "Не найден $CF — запускайте из корня репо" >&2; exit 1; }
[ -f ".env" ] || { echo "Не найден .env" >&2; exit 1; }
[ -f "$USERS_FILE" ] || { echo "Не найден файл ников: $USERS_FILE" >&2; exit 1; }

echo "Создаю аккаунты из '$USERS_FILE' → '$OUT'..." >&2

# One-shot в образе backend: монтируем скрипт и файл ников (rebuild не нужен),
# --no-deps — инфра прода уже поднята; контейнер в той же compose-сети → видит postgres.
# stdout (login<TAB>password) → в файл через tee; stderr (заголовки/итоги) → на экран.
"${DC[@]}" -f "$CF" --env-file .env run --rm --no-deps \
    -v "$ROOT/backend/scripts:/app/scripts:ro" \
    -v "$ROOT/$USERS_FILE:/app/users.md:ro" \
    backend-blue python scripts/create_users.py users.md \
    | tee "$OUT"

echo "" >&2
echo "Готово. Логины/пароли: $OUT" >&2
echo "Формат: логин<TAB>пароль. Раздайте участникам и удалите файл." >&2
