"""Лёгкий сбор метрик производительности: медиа и HTTP-запросы (измерительный слой).

Два раздела, одна механика (JSON-строка в stdout + бакет-гистограмма в Redis):
  * медиа — шаги upload/download, см. ниже и docs/FILES.md «Сбор метрик»;
  * HTTP — время ответа и статусы по шаблонам роутов плюс структурный лог запроса
    со сквозным `request_id`; собирается `ObservabilityMiddleware`, см. в конце файла
    и docs/API_CONVENTIONS.md «Наблюдаемость».

Раздел про медиа:


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


async def _record_hist(key: str, ms: float, ttl_seconds: int) -> None:
    """Учесть длительность в бакет-гистограмму по ключу (best-effort, не бросает).

    Кладём и в бакет (для перцентилей), и в count/sum (для среднего). TTL обновляем
    на каждый удар — окно скользит.
    """
    try:
        pipe = redis_client.pipeline()
        pipe.hincrby(key, _bucket_label(ms), 1)
        pipe.hincrby(key, "count", 1)
        pipe.hincrbyfloat(key, "sum_ms", float(ms))
        pipe.expire(key, ttl_seconds)
        await pipe.execute()
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass


async def record_step(
    op: str, kind: str, source: str, step: str, ms: float
) -> None:
    """Учесть один тайминг шага медиа в гистограмму Redis (best-effort, не бросает).

    `op` — upload/download, `source` — client/server, `step` — presign/put/confirm/
    thumbnail/get/... `ms` — длительность шага.
    """
    if not settings.media_metrics_enabled:
        return
    await _record_hist(
        _hist_key(op, kind, source, step), ms, settings.media_metrics_ttl_seconds
    )


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


async def _scan_keys(match: str) -> list[str]:
    """Все ключи Redis по маске (их немного — десятки комбинаций)."""
    # redis_client создан с decode_responses=True → scan/hgetall отдают str, но стабы
    # redis типизируют их как bytes|str; сужаем через cast (runtime всегда str).
    cursor = 0
    keys: list[str] = []
    while True:
        cursor, batch = await redis_client.scan(cursor, match=match, count=200)
        keys.extend(cast(list[str], batch))
        if cursor == 0:
            break
    return keys


async def _summarize_prefix(prefix: str) -> dict[str, Any]:
    """Свод по гистограммам с общим префиксом: `{ключ: {count, avg_ms, p50, p90, p99}}`.

    Ключ в ответе — без префикса, чтобы читалось глазами.
    """
    out: dict[str, Any] = {}
    for key in await _scan_keys(f"{prefix}*"):
        hist = cast(dict[str, str], await redis_client.hgetall(key))
        if not hist:
            continue
        count = int(hist.get("count", 0))
        sum_ms = float(hist.get("sum_ms", 0.0))
        out[key.removeprefix(prefix)] = {
            "count": count,
            "avg_ms": round(sum_ms / count) if count else 0,
            "p50": _percentile_from_hist(hist, 0.50),
            "p90": _percentile_from_hist(hist, 0.90),
            "p99": _percentile_from_hist(hist, 0.99),
        }
    return dict(sorted(out.items()))


async def summarize() -> dict[str, Any]:
    """Свод по шагам медиа. Для админ-эндпоинта GET /api/metrics/media."""
    if not settings.media_metrics_enabled:
        return {}
    return await _summarize_prefix("metrics:media:")


# ─────────────────────────── HTTP: тайминги и структурный лог ───────────────────────────
#
# Разрез — ШАБЛОН роута (`/api/rooms/{room_id}/messages`), никогда не подставленный
# путь: иначе число ключей Redis растёт с числом комнат и сообщений без предела.
# Отдельно от общей массы считаем именованные сценарии (логин, открытие комнаты,
# лента КБ, дневник Динамики) — по ним спрашивают перцентили в ARG-15.

_HTTP_DUR_PREFIX = "metrics:http:dur:"
_HTTP_STATUS_PREFIX = "metrics:http:status:"
_HTTP_SCENARIO_PREFIX = "metrics:http:scenario:"

# Шаблон роута → имя сценария. Метод не различаем: пары «метод + путь» здесь уникальны.
_SCENARIOS: dict[str, str] = {
    "/api/auth/login": "login",
    "/api/rooms/{room_id}/messages": "room_open",
    "/api/kb/items": "kb_feed",
    "/api/dynamics/my-stats": "dynamics_journal",
}

# Белый список полей структурного лога. Всё, чего здесь нет, в лог не попадает —
# приватность обеспечивается механикой, а не аккуратностью автора. Тела запроса и
# ответа не логируются никогда: они просто не имеют сюда входа.
_ALLOWED_LOG_FIELDS = frozenset(
    {
        "event",
        "request_id",
        "user_id",
        "method",
        "route",
        "scenario",
        "status",
        "server_ms",
        "bytes",
        "error",
        "ts",
    }
)


def scenario_for(route: str) -> str | None:
    """Имя именованного сценария для шаблона роута, если он в списке наблюдаемых."""
    return _SCENARIOS.get(route)


def log_structured(payload: dict[str, Any]) -> None:
    """Записать одну структурную JSON-строку, пропустив её через белый список полей.

    Единственный вход для логов запросов и ошибок. Поля вне списка отбрасываются
    молча — это защита от того, что кто-то однажды добавит в лог текст сообщения.
    Best-effort: сбой лога НИКОГДА не должен ронять запрос.
    """
    try:
        record = {k: v for k, v in payload.items() if k in _ALLOWED_LOG_FIELDS}
        record["ts"] = datetime.now(UTC).isoformat()
        metrics_logger.info(json.dumps(record, ensure_ascii=False, default=str))
    except Exception:  # noqa: BLE001 — лог не важнее запроса
        pass


def _status_class(status: int) -> str:
    """Класс статуса для счётчика: 2xx / 4xx / 5xx (и т.п.), без разбиения по кодам."""
    return f"{status // 100}xx"


async def record_http(method: str, route: str, status: int, ms: float) -> None:
    """Учесть один HTTP-запрос: длительность, класс статуса, именованный сценарий.

    Вызывается ПОСЛЕ того, как ответ ушёл клиенту, — задержки пользователю не добавляет.
    Best-effort: любая ошибка Redis проглатывается.
    """
    if not settings.http_metrics_enabled:
        return
    ttl = settings.http_metrics_ttl_seconds
    label = f"{method}:{route}"
    await _record_hist(f"{_HTTP_DUR_PREFIX}{label}", ms, ttl)
    try:
        key = f"{_HTTP_STATUS_PREFIX}{label}"
        pipe = redis_client.pipeline()
        pipe.hincrby(key, _status_class(status), 1)
        pipe.expire(key, ttl)
        await pipe.execute()
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass
    scenario = scenario_for(route)
    if scenario is not None:
        await _record_hist(f"{_HTTP_SCENARIO_PREFIX}{scenario}", ms, ttl)


async def summarize_http() -> dict[str, Any]:
    """Свод по HTTP: `{routes: {...}, scenarios: {...}}` для GET /api/metrics/http.

    По каждому роуту — count, avg, перцентили, разбивка по классам статусов и доля
    ошибок 5xx. По сценариям — только тайминги: статусы там те же, что у их роутов.
    """
    if not settings.http_metrics_enabled:
        return {"routes": {}, "scenarios": {}}

    routes = await _summarize_prefix(_HTTP_DUR_PREFIX)
    for key in await _scan_keys(f"{_HTTP_STATUS_PREFIX}*"):
        label = key.removeprefix(_HTTP_STATUS_PREFIX)
        row = routes.get(label)
        if row is None:
            continue
        counts = {
            klass: int(n)
            for klass, n in cast(dict[str, str], await redis_client.hgetall(key)).items()
        }
        total = sum(counts.values())
        row["statuses"] = dict(sorted(counts.items()))
        row["error_rate"] = round(counts.get("5xx", 0) / total, 4) if total else 0.0

    return {"routes": routes, "scenarios": await _summarize_prefix(_HTTP_SCENARIO_PREFIX)}
