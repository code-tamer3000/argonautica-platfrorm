#!/usr/bin/env bash
# dev.sh — поднять / остановить / сбросить локальную инфраструктуру.
#
# Использование:
#   ./dev.sh          — запустить postgres + redis + minio, миграции, бакеты
#   ./dev.sh stop     — остановить контейнеры (данные сохраняются)
#   ./dev.sh reset    — остановить + удалить volumes (чистый стейт)
#
# Совместим с Docker Compose v1 (docker-compose) и v2 (docker compose).
set -euo pipefail

# ─── Цвета ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${BOLD}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ! $*${NC}"; }
die()  { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

# ─── Корень репо ────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ─── Docker Compose v1 / v2 ─────────────────────────────────────────────────
# v1: отдельный бинарь 'docker-compose'
# v2: плагин 'docker compose' (subcommand)
# Используем bash-массив, чтобы команды с пробелами не ломались в "${DC[@]}"
step "Docker Compose"
if command -v docker-compose &>/dev/null; then
    DC=(docker-compose)
    ok "v1 — $(docker-compose version --short 2>/dev/null || echo '?')"
elif docker compose version &>/dev/null 2>&1; then
    DC=(docker compose)
    ok "v2 — $(docker compose version --short 2>/dev/null || echo '?')"
else
    die "Ни 'docker-compose', ни плагин 'docker compose' не найдены"
fi

CF="docker/docker-compose.yml"   # dev-compose: только инфра, порты на хост

# ─── Команды stop / reset ───────────────────────────────────────────────────
CMD="${1:-up}"

if [ "$CMD" = "stop" ]; then
    step "Останавливаем контейнеры"
    "${DC[@]}" -f "$CF" stop
    ok "Остановлено (данные сохранены)"
    exit 0
fi

if [ "$CMD" = "reset" ]; then
    step "Удаляем контейнеры и volumes (полный сброс)"
    "${DC[@]}" -f "$CF" down -v --remove-orphans
    ok "Volumes удалены — следующий запуск будет с чистой БД"
    exit 0
fi

[ "$CMD" = "up" ] || die "Неизвестная команда: $CMD (допустимые: up | stop | reset)"

# ─── .env ───────────────────────────────────────────────────────────────────
step ".env"
if [ ! -f .env ]; then
    cp .env.example .env

    # Backend на хосте видит контейнеры через localhost, не по имени сервиса.
    # Правим DATABASE_URL, REDIS_URL и MINIO_ENDPOINT на 127.0.0.1:
    if [[ "$(uname)" == "Darwin" ]]; then
        # BSD sed (macOS) требует пустой аргумент -i
        sed -i '' \
            's|@postgres:|@localhost:|g' \
            's|redis://redis:|redis://localhost:|g' \
            's|http://minio:|http://localhost:|g' .env
    else
        sed -i \
            -e 's|@postgres:|@localhost:|g' \
            -e 's|redis://redis:|redis://localhost:|g' \
            -e 's|http://minio:|http://localhost:|g' .env
    fi

    warn ".env создан из .env.example — проверь пароли и JWT_SECRET"
fi

# Загрузить переменные в окружение скрипта
set -a
# shellcheck disable=SC1091
source .env
set +a

# Проверить обязательные переменные
for v in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
          MINIO_ROOT_USER MINIO_ROOT_PASSWORD \
          MINIO_BUCKET_MEDIA MINIO_BUCKET_KB; do
    [[ -n "${!v:-}" ]] || die "Переменная $v не задана в .env"
done

# ─── Запустить инфраструктуру ────────────────────────────────────────────────
step "Запускаем postgres / redis / minio"
"${DC[@]}" -f "$CF" up -d
ok "Контейнеры подняты"

# ─── Ждать готовности ───────────────────────────────────────────────────────
step "Ожидаем готовности сервисов"

wait_for() {
    # $1 — читаемое имя, $2 — команда (строка, запускается через eval)
    local name="$1"
    local check="$2"
    local timeout=60
    local elapsed=0
    printf "  %-10s " "$name"
    while ! eval "$check" &>/dev/null; do
        printf "."
        sleep 1
        elapsed=$((elapsed + 1))
        if [ $elapsed -ge $timeout ]; then
            echo " ✗"
            die "$name не ответил за ${timeout}с"
        fi
    done
    echo " ✓"
}

# Postgres: запускаем pg_isready внутри контейнера — не требует pg_isready на хосте.
wait_for "postgres" \
    "\"${DC[@]}\" -f \"$CF\" exec -T postgres pg_isready -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -q"

# Redis: ping внутри контейнера.
wait_for "redis" \
    "\"${DC[@]}\" -f \"$CF\" exec -T redis redis-cli ping"

# MinIO: REST-ендпоинт /minio/health/live (curl или wget или python).
if command -v curl &>/dev/null; then
    MINIO_CHECK="curl -sf http://127.0.0.1:9000/minio/health/live"
elif command -v wget &>/dev/null; then
    MINIO_CHECK="wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live"
else
    MINIO_CHECK="python3 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/minio/health/live')\""
fi
wait_for "minio" "$MINIO_CHECK"

# ─── Alembic миграции ───────────────────────────────────────────────────────
step "Alembic — применяем миграции"

# Ищем alembic: сначала через python3 -m (работает в активном venv),
# потом как отдельный бинарь в PATH.
ALEMBIC=""
if python3 -c "import alembic" 2>/dev/null; then
    ALEMBIC="python3 -m alembic"
elif command -v alembic &>/dev/null; then
    ALEMBIC="alembic"
fi

if [ -n "$ALEMBIC" ]; then
    (cd backend && $ALEMBIC upgrade head)
    ok "Миграции применены"
else
    warn "alembic не найден в текущем Python-окружении."
    warn "Активируй venv и выполни:"
    warn "  cd backend && pip install -e . && alembic upgrade head"
fi

# ─── MinIO: создать бакеты ──────────────────────────────────────────────────
step "MinIO — проверяем / создаём бакеты"

# Используем boto3 (зависимость бэкенда) — работает в активном venv.
# Если boto3 нет, выводим инструкцию.
if python3 -c "import boto3" 2>/dev/null; then
    python3 - <<PYEOF
import boto3
from botocore.exceptions import ClientError

s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:9000",
    aws_access_key_id="${MINIO_ROOT_USER}",
    aws_secret_access_key="${MINIO_ROOT_PASSWORD}",
    region_name="us-east-1",
)

buckets = ["${MINIO_BUCKET_MEDIA}", "${MINIO_BUCKET_KB}"]
for b in buckets:
    try:
        s3.head_bucket(Bucket=b)
        print(f"  ✓ бакет {b} уже существует")
    except ClientError:
        s3.create_bucket(Bucket=b)
        print(f"  ✓ бакет {b} создан")
PYEOF
else
    warn "boto3 не найден — бакеты нужно создать вручную (или активировать venv)."
    warn "  pip install boto3"
    warn "  Затем перезапусти ./dev.sh"
fi

# ─── Итог ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Инфраструктура готова${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo ""
printf "  %-14s %s\n" "Postgres"   "127.0.0.1:5432  (db: ${POSTGRES_DB})"
printf "  %-14s %s\n" "Redis"      "127.0.0.1:6379"
printf "  %-14s %s\n" "MinIO S3"   "http://127.0.0.1:9000"
printf "  %-14s %s\n" "MinIO UI"   "http://127.0.0.1:9001  (${MINIO_ROOT_USER} / ${MINIO_ROOT_PASSWORD})"
echo ""
echo "  Следующие шаги:"
echo "    Backend:   cd backend && uvicorn app.main:app --reload"
echo "    Frontend:  cd frontend && npm run dev"
echo "    Тесты:     cd backend && pytest"
echo "    Стоп:      ./dev.sh stop"
echo "    Сброс БД:  ./dev.sh reset"
echo ""
