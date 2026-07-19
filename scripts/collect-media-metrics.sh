#!/usr/bin/env bash
# Выгрузка метрик медиа с прода в один архив (для анализа «где теряется время»).
#
# Собирает ТРИ источника, описанных в docs/FILES.md «Сбор метрик»:
#   1. summary.json   — свод перцентилей из Redis (GET /api/metrics/media, админ)
#   2. backend.log    — сырые события: клиентские трейсы + серверная разбивка confirm
#   3. nginx.log      — тайминги отдачи MinIO (log_format media_perf)
# Плюс meta.txt (когда снято, флаг включён/нет). Итог — media-metrics-<ts>.tar.gz.
#
# Только чтение: docker logs / один GET. Ничего на проде не меняет, prod-compose
# не трогает — контейнеры находит по ИМЕНИ СЕРВИСА (у них нет container_name).
#
# Запуск на сервере, из каталога с docker-compose.prod.yml:
#   ADMIN_TOKEN=<admin_JWT> ./scripts/collect-media-metrics.sh
# Опционально:
#   BASE_URL=https://localhost   COMPOSE="docker compose -f docker/docker-compose.prod.yml"
#   LOG_TAIL=5000   (сколько последних строк лога брать, дефолт 5000)
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
LOG_TAIL="${LOG_TAIL:-5000}"
COMPOSE="${COMPOSE:-docker compose -f docker/docker-compose.prod.yml}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$(mktemp -d)/media-metrics-${TS}"
mkdir -p "$OUT_DIR"

say() { printf '  %s\n' "$*"; }

# Имя запущенного контейнера по имени сервиса compose (первый running).
container_for() {
  $COMPOSE ps -q "$1" 2>/dev/null | head -n1
}

echo "Собираю метрики медиа → ${OUT_DIR}"

# ── 1. Свод перцентилей (админский GET) ───────────────────────────────────────
if [[ -n "${ADMIN_TOKEN:-}" ]]; then
  if curl -fsS -H "Authorization: Bearer ${ADMIN_TOKEN}" \
       "${BASE_URL%/}/api/metrics/media" -o "$OUT_DIR/summary.json"; then
    say "summary.json — свод перцентилей получен"
    if grep -q '"enabled": *false' "$OUT_DIR/summary.json" 2>/dev/null; then
      say "⚠  enabled:false — сбор ВЫКЛЮЧЕН (MEDIA_METRICS_ENABLED). Данных не будет."
    fi
  else
    say "⚠  свод не получен (проверь ADMIN_TOKEN / BASE_URL=${BASE_URL})"
  fi
else
  say "⚠  ADMIN_TOKEN не задан — summary.json пропущен (сырые логи всё равно соберу)"
fi

# ── 2. Backend: клиентские трейсы + серверная разбивка confirm ────────────────
# Активен ОДИН из blue/green — берём логи обоих, какой запущен, тот и даст строки.
: > "$OUT_DIR/backend.log"
for svc in backend-blue backend-green; do
  cid="$(container_for "$svc")"
  [[ -z "$cid" ]] && continue
  # grep не должен ронять скрипт (set -e), если совпадений нет → || true
  docker logs --tail "$LOG_TAIL" "$cid" 2>&1 | grep '"metric"' >> "$OUT_DIR/backend.log" || true
  say "backend.log ← $svc ($(docker logs --tail "$LOG_TAIL" "$cid" 2>&1 | grep -c '"metric"' || echo 0) строк)"
done

# ── 3. nginx: тайминги отдачи MinIO ───────────────────────────────────────────
: > "$OUT_DIR/nginx.log"
ncid="$(container_for nginx)"
if [[ -n "$ncid" ]]; then
  # Пишется в файл /var/log/nginx/media_perf.log; если его нет (шаблон не применён) —
  # пробуем stdout контейнера.
  if docker exec "$ncid" test -f /var/log/nginx/media_perf.log 2>/dev/null; then
    docker exec "$ncid" tail -n "$LOG_TAIL" /var/log/nginx/media_perf.log > "$OUT_DIR/nginx.log" 2>/dev/null || true
    say "nginx.log ← /var/log/nginx/media_perf.log"
  else
    docker logs --tail "$LOG_TAIL" "$ncid" 2>&1 | grep media_perf > "$OUT_DIR/nginx.log" || true
    say "nginx.log ← stdout контейнера (файл лога не найден — nginx-шаблон, возможно, не применён)"
  fi
else
  say "⚠  контейнер nginx не найден — nginx.log пропущен"
fi

# ── meta ──────────────────────────────────────────────────────────────────────
{
  echo "collected_at_utc: $TS"
  echo "base_url:         $BASE_URL"
  echo "log_tail:         $LOG_TAIL"
  echo "backend_lines:    $(wc -l < "$OUT_DIR/backend.log" | tr -d ' ')"
  echo "nginx_lines:      $(wc -l < "$OUT_DIR/nginx.log" | tr -d ' ')"
} > "$OUT_DIR/meta.txt"

# ── упаковка ──────────────────────────────────────────────────────────────────
ARCHIVE="$(pwd)/media-metrics-${TS}.tar.gz"
tar -czf "$ARCHIVE" -C "$(dirname "$OUT_DIR")" "$(basename "$OUT_DIR")"
rm -rf "$(dirname "$OUT_DIR")"

echo
echo "Готово → $ARCHIVE"
echo "Скинь этот файл в чат для анализа."
