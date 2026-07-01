#!/usr/bin/env bash
# dev.sh — поднять / остановить / сбросить полное локальное окружение.
#
# Использование:
#   ./dev.sh          — инфра + миграции + бэкенд + фронт
#   ./dev.sh stop     — остановить бэкенд/фронт + docker (данные сохраняются)
#   ./dev.sh reset    — stop + удалить docker-volumes (чистый стейт)
#   ./dev.sh logs     — хвост логов бэкенда и фронта
#
# Совместим с Docker Compose v1 (docker-compose) и v2 (docker compose).
set -euo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${BOLD}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ! $*${NC}"; }
die()  { echo -e "${RED}  ✗ $*${NC}" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DEV_DIR="$ROOT/.dev"          # PID и лог-файлы (gitignore)
BACKEND_PID="$DEV_DIR/backend.pid"
FRONTEND_PID="$DEV_DIR/frontend.pid"
BACKEND_LOG="$DEV_DIR/backend.log"
FRONTEND_LOG="$DEV_DIR/frontend.log"

CF="docker/docker-compose.yml"

# ─── Docker Compose v1 / v2 ─────────────────────────────────────────────────
if command -v docker-compose &>/dev/null; then
    DC=(docker-compose)
elif docker compose version &>/dev/null 2>&1; then
    DC=(docker compose)
else
    die "Ни 'docker-compose', ни плагин 'docker compose' не найдены"
fi

# ─── Убить процесс по PID-файлу ─────────────────────────────────────────────
kill_pid_file() {
    local f="$1" name="$2"
    if [ -f "$f" ]; then
        local pid
        pid=$(cat "$f")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && ok "$name остановлен (pid $pid)"
        fi
        rm -f "$f"
    fi
}

# ─── stop ────────────────────────────────────────────────────────────────────
if [ "${1:-up}" = "stop" ] || [ "${1:-up}" = "reset" ]; then
    step "Останавливаем бэкенд и фронтенд"
    kill_pid_file "$BACKEND_PID"  "backend"
    kill_pid_file "$FRONTEND_PID" "frontend"

    step "Останавливаем docker-контейнеры"
    if [ "${1}" = "reset" ]; then
        "${DC[@]}" -f "$CF" down -v --remove-orphans
        ok "Volumes удалены — следующий запуск будет с чистой БД"
    else
        "${DC[@]}" -f "$CF" stop
        ok "Контейнеры остановлены (данные сохранены)"
    fi
    exit 0
fi

# ─── logs ────────────────────────────────────────────────────────────────────
if [ "${1:-up}" = "logs" ]; then
    [ -f "$BACKEND_LOG" ]  || die "Лог бэкенда не найден: $BACKEND_LOG"
    [ -f "$FRONTEND_LOG" ] || die "Лог фронтенда не найден: $FRONTEND_LOG"
    echo "backend → $BACKEND_LOG"
    echo "frontend → $FRONTEND_LOG"
    tail -f "$BACKEND_LOG" "$FRONTEND_LOG"
    exit 0
fi

[ "${1:-up}" = "up" ] || die "Неизвестная команда: ${1} (up | stop | reset | logs)"

mkdir -p "$DEV_DIR"

# ─── .env ────────────────────────────────────────────────────────────────────
step ".env"
if [ ! -f .env ]; then
    cp .env.example .env
    # Backend на хосте видит контейнеры через localhost, не по имени сервиса docker.
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' \
            -e 's|@postgres:|@localhost:|g' \
            -e 's|redis://redis:|redis://localhost:|g' \
            -e 's|http://minio:|http://localhost:|g' .env
    else
        sed -i \
            -e 's|@postgres:|@localhost:|g' \
            -e 's|redis://redis:|redis://localhost:|g' \
            -e 's|http://minio:|http://localhost:|g' .env
    fi
    warn ".env создан из .env.example — проверь пароли и JWT_SECRET"
fi

set -a; source .env; set +a

for v in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
          MINIO_ROOT_USER MINIO_ROOT_PASSWORD \
          MINIO_BUCKET_MEDIA MINIO_BUCKET_KB; do
    [[ -n "${!v:-}" ]] || die "Переменная $v не задана в .env"
done

# ─── Инфраструктура ──────────────────────────────────────────────────────────
step "Docker Compose"
ok "${DC[*]} — запускаем postgres / redis / minio"
"${DC[@]}" -f "$CF" up -d

# ─── Ждать готовности сервисов ───────────────────────────────────────────────
step "Ожидаем готовности сервисов"

wait_for() {
    local name="$1" check="$2" timeout=60 elapsed=0
    printf "  %-10s " "$name"
    while ! eval "$check" &>/dev/null; do
        printf "."
        sleep 1
        elapsed=$((elapsed + 1))
        [ $elapsed -lt $timeout ] || { echo " ✗ timeout"; die "$name не ответил за ${timeout}с"; }
    done
    echo " ✓"
}

wait_for "postgres" \
    "\"${DC[@]}\" -f \"$CF\" exec -T postgres pg_isready -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -q"
wait_for "redis" \
    "\"${DC[@]}\" -f \"$CF\" exec -T redis redis-cli ping"

if command -v curl &>/dev/null; then
    MINIO_CHECK="curl -sf http://127.0.0.1:9000/minio/health/live"
elif command -v wget &>/dev/null; then
    MINIO_CHECK="wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live"
else
    MINIO_CHECK="python3 -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:9000/minio/health/live')\""
fi
wait_for "minio" "$MINIO_CHECK"

# ─── Alembic миграции ────────────────────────────────────────────────────────
step "Alembic — применяем миграции"

# URL строим из переменных напрямую (не из DATABASE_URL в .env, которая может
# содержать docker-имя сервиса 'postgres' вместо localhost).
LOCAL_DB_URL="postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"

VENV="$ROOT/backend/.venv"
if [ -x "$VENV/bin/alembic" ]; then
    ALEMBIC="$VENV/bin/alembic"
elif python3 -c "import alembic" 2>/dev/null; then
    ALEMBIC="python3 -m alembic"
elif command -v alembic &>/dev/null; then
    ALEMBIC="alembic"
else
    ALEMBIC=""
fi

if [ -n "$ALEMBIC" ]; then
    (cd backend && DATABASE_URL="$LOCAL_DB_URL" $ALEMBIC upgrade head)
    ok "Миграции применены"
else
    warn "alembic не найден — выполни вручную:"
    warn "  cd backend && pip install -e . && alembic upgrade head"
fi

# ─── MinIO бакеты ────────────────────────────────────────────────────────────
step "MinIO — проверяем / создаём бакеты"

PYTHON3=""
[ -x "$VENV/bin/python3" ] && PYTHON3="$VENV/bin/python3"
[ -z "$PYTHON3" ] && command -v python3 &>/dev/null && PYTHON3="python3"

if [ -n "$PYTHON3" ] && "$PYTHON3" -c "import boto3" 2>/dev/null; then
    "$PYTHON3" - <<PYEOF
import boto3
from botocore.exceptions import ClientError

s3 = boto3.client(
    "s3",
    endpoint_url="http://127.0.0.1:9000",
    aws_access_key_id="${MINIO_ROOT_USER}",
    aws_secret_access_key="${MINIO_ROOT_PASSWORD}",
    region_name="us-east-1",
)
for b in ["${MINIO_BUCKET_MEDIA}", "${MINIO_BUCKET_KB}"]:
    try:
        s3.head_bucket(Bucket=b)
        print(f"  ✓ {b} уже существует")
    except ClientError:
        s3.create_bucket(Bucket=b)
        print(f"  ✓ {b} создан")
PYEOF
else
    warn "boto3 не найден — бакеты создадутся при первом обращении или создай вручную"
fi

# ─── Backend (uvicorn) ───────────────────────────────────────────────────────
step "Backend — запускаем uvicorn"

if [ -x "$VENV/bin/uvicorn" ]; then
    UVICORN="$VENV/bin/uvicorn"
elif command -v uvicorn &>/dev/null; then
    UVICORN="uvicorn"
else
    UVICORN=""
fi

if [ -n "$UVICORN" ]; then
    # Завершить предыдущий процесс, если был.
    kill_pid_file "$BACKEND_PID" "backend (старый)"

    (
        cd "$ROOT/backend"
        DATABASE_URL="$LOCAL_DB_URL" \
        REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}" \
        MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:9000}" \
        $UVICORN app.main:app --host 127.0.0.1 --port 8000 --reload
    ) >> "$BACKEND_LOG" 2>&1 &

    echo $! > "$BACKEND_PID"
    ok "uvicorn запущен (pid $(cat "$BACKEND_PID")) → $BACKEND_LOG"
else
    warn "uvicorn не найден — запусти вручную:"
    warn "  cd backend && source .venv/bin/activate && uvicorn app.main:app --reload"
fi

# ─── Frontend (vite dev) ─────────────────────────────────────────────────────
step "Frontend — npm install + vite dev"

if ! command -v node &>/dev/null; then
    warn "node не найден — фронтенд нужно запустить вручную:"
    warn "  cd frontend && npm install && npm run dev"
else
    kill_pid_file "$FRONTEND_PID" "frontend (старый)"

    # npm install только если node_modules отсутствует или package-lock изменился.
    if [ ! -d "$ROOT/frontend/node_modules" ] || \
       [ "$ROOT/frontend/package-lock.json" -nt "$ROOT/frontend/node_modules/.package-lock.json" ]; then
        ok "npm install..."
        npm --prefix "$ROOT/frontend" install --silent 2>>"$FRONTEND_LOG"
    fi

    # BACKEND_URL=http://localhost:8000 — vite.config.ts читает через process.env.
    (
        cd "$ROOT/frontend"
        BACKEND_URL="http://localhost:8000" npm run dev
    ) >> "$FRONTEND_LOG" 2>&1 &

    echo $! > "$FRONTEND_PID"
    ok "vite запущен (pid $(cat "$FRONTEND_PID")) → $FRONTEND_LOG"
fi

# ─── Итог ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Всё запущено${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo ""
printf "  %-16s %s\n" "Frontend"  "http://localhost:5173"
printf "  %-16s %s\n" "Backend"   "http://localhost:8000"
printf "  %-16s %s\n" "Postgres"  "127.0.0.1:5432  (db: ${POSTGRES_DB})"
printf "  %-16s %s\n" "Redis"     "127.0.0.1:6379"
printf "  %-16s %s\n" "MinIO S3"  "http://127.0.0.1:9000"
printf "  %-16s %s\n" "MinIO UI"  "http://127.0.0.1:9001"
echo ""
echo "  ./dev.sh logs   — хвост логов бэкенда и фронта"
echo "  ./dev.sh stop   — остановить всё (данные сохраняются)"
echo "  ./dev.sh reset  — остановить + удалить БД/volumes"
echo ""
