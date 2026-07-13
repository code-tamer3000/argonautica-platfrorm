"""Лёгкий сбор метрик производительности медиа (измерительный слой).

Зачем: «с телефона долго грузит фото/видео и долго отправляет». Прежде чем чинить —
меряем, ГДЕ теряется время. Три источника таймингов сходятся сюда:
  * клиент — реальные шаги с мобильной сети (presign → PUT в MinIO → confirm → GET);
  * бэкенд — сколько в confirm_upload заняли head_object и генерация превью;
  * nginx — время отдачи MinIO (отдельный log_format, не через этот модуль).

Вывод — ОДНА JSON-строка в stdout на событие (`docker logs | grep '"metric"'`; JSON
печатается с пробелами после двоеточий, поэтому грепаем по ключу, а не по `:media`)
плюс агрегаты (перцентили) в Redis со скользящим окном (сутки). Никакой новой
инфраструктуры: логгер настраивается тут, не трогая root-логгер приложения.

Формат строки (стабилен — на него завязан грепанье в docs/FILES.md):

    {"metric":"media","op":"upload","kind":"image","source":"client",
     "size":1234567,"total_ms":8421,"steps":{"presign_ms":90,"put_ms":8100,...},
     "net":"4g","ts":"2026-07-14T..."}
"""
import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any, cast

from app.core.config import settings
from app.core.redis import redis_client

# Отдельный логгер: свой хендлер в stdout, propagate=False — не зависим от того,
# сконфигурирован ли root-логгер, и не задваиваем строки. Идемпотентно (модуль
# импортируется один раз, но защищаемся от повторного добавления хендлера).
metrics_logger = logging.getLogger("app.metrics")
if not metrics_logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))  # строка уже готовый JSON
    metrics_logger.addHandler(_handler)
    metrics_logger.setLevel(logging.INFO)
    metrics_logger.propagate = False


def log_media_metric(payload: dict[str, Any]) -> None:
    """Записать одно событие метрики медиа JSON-строкой (best-effort, не бросает).

    Вызывается с горячего пути (confirm_upload, приём клиентских трейсов) — сбой
    сериализации/лога НИКОГДА не должен ронять сам запрос.
    """
    try:
        record = {"metric": "media", **payload, "ts": datetime.now(UTC).isoformat()}
        line = json.dumps(record, ensure_ascii=False, default=str)
        metrics_logger.info(line)
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass


# ───────────────────────────── Агрегаты в Redis ─────────────────────────────
#
# Для перцентилей держим компактную гистограмму по бакетам длительности на каждый
# (op, kind, source, step). Точные перцентили не нужны — важно «PUT в 4g обычно 8с,
# хвост 30с». Бакеты покрывают 0..>60с; HINCRBY по бакету, TTL сутки. Так свод не
# растёт с числом событий и читается одним HGETALL.

# Границы бакетов в мс (верхняя граница включительно); последний — переполнение.
_BUCKET_BOUNDS_MS = (
    50, 100, 200, 350, 500, 750, 1000, 1500, 2000, 3000, 5000,
    7500, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000,
)


def _bucket_label(ms: float) -> str:
    """Метка бакета для длительности (мс): `<=NNNN` или `>60000` для хвоста."""
    for bound in _BUCKET_BOUNDS_MS:
        if ms <= bound:
            return f"<={bound}"
    return f">{_BUCKET_BOUNDS_MS[-1]}"


def _hist_key(op: str, kind: str, source: str, step: str) -> str:
    return f"metrics:media:{source}:{op}:{kind}:{step}"


async def record_step(
    op: str, kind: str, source: str, step: str, ms: float
) -> None:
    """Учесть один тайминг шага в гистограмму Redis (best-effort, не бросает).

    `op` — upload/download, `source` — client/server, `step` — presign/put/confirm/
    thumbnail/get/... `ms` — длительность шага. Кладём и в бакет-гистограмму (для
    перцентилей), и в count/sum (для среднего). TTL обновляем на каждый удар —
    окно скользит.
    """
    if not settings.media_metrics_enabled:
        return
    try:
        key = _hist_key(op, kind, source, step)
        pipe = redis_client.pipeline()
        pipe.hincrby(key, _bucket_label(ms), 1)
        pipe.hincrby(key, "count", 1)
        pipe.hincrbyfloat(key, "sum_ms", float(ms))
        pipe.expire(key, settings.media_metrics_ttl_seconds)
        await pipe.execute()
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass


def _percentile_from_hist(hist: dict[str, str], q: float) -> str:
    """Оценка перцентиля по гистограмме бакетов: вернуть метку бакета, в который
    попадает q-й элемент (напр. q=0.9 → p90). Грубо (гранулярность бакета), но для
    «где хвост» достаточно. `hist` — сырой HGETALL (метки бакетов + count/sum_ms).
    """
    buckets = [
        (label, int(cnt))
        for label, cnt in hist.items()
        if label not in ("count", "sum_ms")
    ]
    total = sum(c for _, c in buckets)
    if total == 0:
        return "n/a"
    # Порядок бакетов — по возрастанию границы; хвост (`>...`) в конец.
    def _sort_key(item: tuple[str, int]) -> float:
        label = item[0]
        return float("inf") if label.startswith(">") else float(label[2:])

    buckets.sort(key=_sort_key)
    target = q * total
    cumulative = 0
    for label, cnt in buckets:
        cumulative += cnt
        if cumulative >= target:
            return label
    return buckets[-1][0]


async def summarize() -> dict[str, Any]:
    """Свод по всем накопленным гистограммам: `{step_key: {count, avg_ms, p50, p90, p99}}`.

    Читаем ключи `metrics:media:*` (их немного — десятки комбинаций), по каждому
    считаем count/avg/перцентили. Для админ-эндпоинта /api/metrics/media.
    """
    out: dict[str, Any] = {}
    if not settings.media_metrics_enabled:
        return out
    # redis_client создан с decode_responses=True → scan/hgetall отдают str, но стабы
    # redis типизируют их как bytes|str; сужаем через cast (runtime всегда str).
    cursor = 0
    keys: list[str] = []
    while True:
        cursor, batch = await redis_client.scan(
            cursor, match="metrics:media:*", count=200
        )
        keys.extend(cast(list[str], batch))
        if cursor == 0:
            break
    for key in keys:
        hist = cast(dict[str, str], await redis_client.hgetall(key))
        if not hist:
            continue
        count = int(hist.get("count", 0))
        sum_ms = float(hist.get("sum_ms", 0.0))
        avg = round(sum_ms / count) if count else 0
        # Ключ без префикса `metrics:media:` — читаемое имя шага.
        short = key.removeprefix("metrics:media:")
        out[short] = {
            "count": count,
            "avg_ms": avg,
            "p50": _percentile_from_hist(hist, 0.50),
            "p90": _percentile_from_hist(hist, 0.90),
            "p99": _percentile_from_hist(hist, 0.99),
        }
    return dict(sorted(out.items()))
