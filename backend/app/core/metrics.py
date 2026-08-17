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
from app.services.system_metrics import collect_snapshot

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


# ─────────────────────────── Клиентский RUM ───────────────────────────
#
# Что меряет браузер и зачем (docs/FRONTEND.md «Клиентский RUM»):
#   * загрузка приложения — Navigation Timing (dns/tcp/tls/ttfb/dom_interactive) + LCP.
#     Разделитель, ради которого всё делается: `ttfb` = канал плюс сервер,
#     `frontend` = `lcp − ttfb` = собственно фронт. Разрезы — холодный/тёплый заход
#     и тип сети, плюс версия сборки (без неё цифры до и после релиза смешиваются);
#   * открытие комнаты — запрос истории → первый байт → отрисовка списка;
#   * сумма `transferSize` по типам медиа на первом и повторном заходе в комнату —
#     так видно, работает ли браузерный кэш медиа (ARG-75) или сломался молча;
#   * упавший экран — сообщение, стек, роут, версия сборки. Без пользовательского текста.
#
# Значения клиентские и не доверенные: только наблюдение. Всё best-effort — приём
# метрик не имеет права ронять ни один экран.

_CLIENT_NAV_PREFIX = "metrics:client:nav:"
_CLIENT_SCENARIO_PREFIX = "metrics:client:scenario:"
_CLIENT_BYTES_PREFIX = "metrics:client:bytes:"
_CLIENT_ERRORS_KEY = "metrics:client:errors"
_CLIENT_ERRORS_RECENT_KEY = "metrics:client:errors:recent"

# Белый список полей клиентского лога — как у структурного лога запросов: приватность
# обеспечивается механикой, а не аккуратностью автора. Текста сообщений, имён файлов и
# прочего пользовательского контента здесь просто нет входа.
_ALLOWED_CLIENT_LOG_FIELDS = frozenset(
    {
        "metric",
        "kind",
        "build",
        "cold",
        "net",
        "route",
        "visit",
        "total_ms",
        "steps",
        "bytes",
        "message",
        "stack",
        "user_id",
        "ts",
    }
)


def log_client_metric(payload: dict[str, Any]) -> None:
    """Записать одно клиентское событие JSON-строкой (`"metric":"client"`).

    Best-effort и через белый список полей — как `log_structured` для запросов.
    """
    try:
        record = {"metric": "client"}
        record.update({k: v for k, v in payload.items() if k in _ALLOWED_CLIENT_LOG_FIELDS})
        record["ts"] = datetime.now(UTC).isoformat()
        metrics_logger.info(json.dumps(record, ensure_ascii=False, default=str))
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass


def _client_label(value: str | None, default: str = "unknown") -> str:
    """Безопасная метка для ключа Redis: без двоеточий, короткая, непустая.

    Значения приходят от клиента — они не должны ни ломать разбор ключа, ни плодить
    ключи без предела (поэтому же на приёме ограничена длина полей).
    """
    if not value:
        return default
    return value.replace(":", "_")[:32]


async def record_client_nav(cold: bool | None, net: str | None, step: str, ms: float) -> None:
    """Учесть один шаг загрузки приложения в разрезе холодный/тёплый + тип сети."""
    if not settings.client_metrics_enabled:
        return
    visit = "cold" if cold else "warm" if cold is not None else "unknown"
    key = f"{_CLIENT_NAV_PREFIX}{visit}:{_client_label(net)}:{_client_label(step)}"
    await _record_hist(key, ms, settings.client_metrics_ttl_seconds)


async def record_client_scenario(scenario: str, step: str, ms: float) -> None:
    """Учесть шаг клиентского сценария (напр. `room_open` → `ttfb`/`render`/`total`)."""
    if not settings.client_metrics_enabled:
        return
    key = f"{_CLIENT_SCENARIO_PREFIX}{_client_label(scenario)}:{_client_label(step)}"
    await _record_hist(key, ms, settings.client_metrics_ttl_seconds)


async def record_client_bytes(visit: str, kind: str, size: int) -> None:
    """Учесть скачанные байты одного типа ресурса за заход в комнату.

    `visit` — `first`/`repeat` (первый или повторный заход в ту же комнату),
    `kind` — image/video/audio/other. Копим count и sum_bytes: сравнение среднего
    на первом и повторном заходе и есть метрика попадания в кэш медиа.
    """
    if not settings.client_metrics_enabled:
        return
    key = f"{_CLIENT_BYTES_PREFIX}{_client_label(visit)}:{_client_label(kind)}"
    try:
        pipe = redis_client.pipeline()
        pipe.hincrby(key, "count", 1)
        pipe.hincrby(key, "sum_bytes", int(size))
        pipe.expire(key, settings.client_metrics_ttl_seconds)
        await pipe.execute()
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass


async def record_client_error(build: str | None, route: str | None, message: str) -> None:
    """Учесть упавший экран: счётчик по «версия сборки + роут» + кольцо последних.

    Кольцо (`client_errors_keep`) нужно, чтобы в своде было видно не только «сколько»,
    но и «что именно» — иначе за цифрой пришлось бы лезть в логи контейнера.
    """
    if not settings.client_metrics_enabled:
        return
    try:
        field = f"{_client_label(build, 'unknown')} {_client_label(route, '/')}"
        ttl = settings.client_metrics_ttl_seconds
        pipe = redis_client.pipeline()
        pipe.hincrby(_CLIENT_ERRORS_KEY, field, 1)
        pipe.expire(_CLIENT_ERRORS_KEY, ttl)
        pipe.lpush(
            _CLIENT_ERRORS_RECENT_KEY,
            json.dumps(
                {
                    "ts": datetime.now(UTC).isoformat(),
                    "build": build,
                    "route": route,
                    "message": message,
                },
                ensure_ascii=False,
            ),
        )
        pipe.ltrim(_CLIENT_ERRORS_RECENT_KEY, 0, settings.client_errors_keep - 1)
        pipe.expire(_CLIENT_ERRORS_RECENT_KEY, ttl)
        await pipe.execute()
    except Exception:  # noqa: BLE001 — метрика не важнее запроса
        pass


async def _summarize_client_bytes() -> dict[str, Any]:
    """Свод по скачанным байтам: `{"first:image": {count, sum_bytes, avg_bytes}}`."""
    out: dict[str, Any] = {}
    for key in await _scan_keys(f"{_CLIENT_BYTES_PREFIX}*"):
        row = cast(dict[str, str], await redis_client.hgetall(key))
        if not row:
            continue
        count = int(row.get("count", 0))
        total = int(row.get("sum_bytes", 0))
        out[key.removeprefix(_CLIENT_BYTES_PREFIX)] = {
            "count": count,
            "sum_bytes": total,
            "avg_bytes": round(total / count) if count else 0,
        }
    return dict(sorted(out.items()))


async def _summarize_client_errors() -> dict[str, Any]:
    """Свод по упавшим экранам: счётчики «сборка + роут» и последние записи."""
    try:
        counts = {
            field: int(n)
            for field, n in cast(
                dict[str, str], await redis_client.hgetall(_CLIENT_ERRORS_KEY)
            ).items()
        }
        raw = cast(
            list[str], await redis_client.lrange(_CLIENT_ERRORS_RECENT_KEY, 0, -1)
        )
    except Exception:  # noqa: BLE001 — свод не важнее доступности админки
        return {"counts": {}, "recent": []}
    recent: list[dict[str, Any]] = []
    for line in raw:
        try:
            recent.append(json.loads(line))
        except ValueError:
            continue
    return {"counts": dict(sorted(counts.items())), "recent": recent}


async def summarize_client() -> dict[str, Any]:
    """Свод клиентского RUM для GET /api/metrics/client (админ).

    `{first_screen, scenarios, bytes, errors}`: перцентили первого экрана в разрезе
    холодный/тёплый и тип сети, тайминги сценариев, байты по типам медиа, ошибки.
    """
    if not settings.client_metrics_enabled:
        return {"first_screen": {}, "scenarios": {}, "bytes": {}, "errors": {}}
    return {
        "first_screen": await _summarize_prefix(_CLIENT_NAV_PREFIX),
        "scenarios": await _summarize_prefix(_CLIENT_SCENARIO_PREFIX),
        "bytes": await _summarize_client_bytes(),
        "errors": await _summarize_client_errors(),
    }


# ─────────────────────────── Экспорт в формате Prometheus (ARG-82) ───────────────────────────
#
# `GET /metrics` (backend/app/main.py) рендерит текущие агрегаты Redis построчно в
# формате Prometheus exposition, а не из in-memory `prometheus_client`: бэкенд поднят
# как `uvicorn --workers 2` плюс blue-green, у in-memory реестра скрейп попадал бы на
# случайный воркер и показывал половину цифр. Redis общий для всех воркеров и обоих
# цветов — рендерим прямо из него, тем же путём, что и админский свод выше, поэтому
# цифры сходятся с ним по построению.
#
# Бакеты гистограмм в Redis НЕ кумулятивны (HINCRBY бьёт только в один подходящий
# бакет) — Prometheus требует кумулятивные `_bucket{le=...}`. Кумулятивную сумму
# считаем здесь, при рендере; границы (`_BUCKET_BOUNDS_MS`) остаются те же, что и в
# существующих сводах — цифры сравнимы с уже накопленными.


def _prom_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _prom_labels(labels: dict[str, str]) -> str:
    if not labels:
        return ""
    pairs = ",".join(f'{k}="{_prom_escape(v)}"' for k, v in labels.items())
    return f"{{{pairs}}}"


def _prom_histogram_lines(
    name: str, labels: dict[str, str], hist: dict[str, str]
) -> list[str]:
    """Кумулятивные `_bucket`/`_sum`/`_count` строки Prometheus из бакет-гистограммы Redis."""
    per_bucket: dict[float, int] = {}
    overflow = 0
    for label, raw in hist.items():
        if label in ("count", "sum_ms"):
            continue
        try:
            n = int(raw)
        except ValueError:
            continue
        if label.startswith("<="):
            bound = float(label[2:])
            per_bucket[bound] = per_bucket.get(bound, 0) + n
        elif label.startswith(">"):
            overflow += n

    lines: list[str] = []
    cumulative = 0
    for bound in _BUCKET_BOUNDS_MS:
        cumulative += per_bucket.get(float(bound), 0)
        lines.append(f"{name}_bucket{_prom_labels({**labels, 'le': str(bound)})} {cumulative}")
    cumulative += overflow
    lines.append(f"{name}_bucket{_prom_labels({**labels, 'le': '+Inf'})} {cumulative}")
    lines.append(f"{name}_sum{_prom_labels(labels)} {float(hist.get('sum_ms', 0.0))}")
    lines.append(f"{name}_count{_prom_labels(labels)} {int(hist.get('count', 0))}")
    return lines


async def _prom_histograms_by_prefix(
    name: str, prefix: str, label_names: tuple[str, ...]
) -> list[str]:
    """Гистограммы Prometheus для всех ключей с общим префиксом.

    Часть ключа после префикса разбирается на `label_names` разбиением по `:`
    (последняя метка забирает остаток — так шаблоны роутов с `/` внутри не режутся).
    """
    header = [f"# HELP {name} Distribution in milliseconds.", f"# TYPE {name} histogram"]
    lines: list[str] = []
    for key in await _scan_keys(f"{prefix}*"):
        hist = cast(dict[str, str], await redis_client.hgetall(key))
        if not hist:
            continue
        parts = key.removeprefix(prefix).split(":", len(label_names) - 1)
        if len(parts) != len(label_names):
            continue
        labels = dict(zip(label_names, parts, strict=True))
        lines.extend(_prom_histogram_lines(name, labels, hist))
    return header + lines if lines else []


async def _prom_http_status_counters() -> list[str]:
    name = "http_requests_total"
    header = [f"# HELP {name} HTTP responses by status class.", f"# TYPE {name} counter"]
    lines: list[str] = []
    for key in await _scan_keys(f"{_HTTP_STATUS_PREFIX}*"):
        counts = cast(dict[str, str], await redis_client.hgetall(key))
        method, _, route = key.removeprefix(_HTTP_STATUS_PREFIX).partition(":")
        for status_class, raw in counts.items():
            try:
                n = int(raw)
            except ValueError:
                continue
            labels = {"method": method, "route": route, "status_class": status_class}
            lines.append(f"{name}{_prom_labels(labels)} {n}")
    return header + lines if lines else []


async def _prom_client_bytes_counters() -> list[str]:
    bytes_name = "client_download_bytes_total"
    count_name = "client_download_events_total"
    header = [
        f"# HELP {bytes_name} Bytes downloaded by clients, by visit/kind.",
        f"# TYPE {bytes_name} counter",
        f"# HELP {count_name} Client download events, by visit/kind.",
        f"# TYPE {count_name} counter",
    ]
    lines: list[str] = []
    for key in await _scan_keys(f"{_CLIENT_BYTES_PREFIX}*"):
        row = cast(dict[str, str], await redis_client.hgetall(key))
        if not row:
            continue
        visit, _, kind = key.removeprefix(_CLIENT_BYTES_PREFIX).partition(":")
        labels = _prom_labels({"visit": visit, "kind": kind})
        lines.append(f"{bytes_name}{labels} {int(row.get('sum_bytes', 0))}")
        lines.append(f"{count_name}{labels} {int(row.get('count', 0))}")
    return header + lines if lines else []


async def _prom_client_error_counters() -> list[str]:
    name = "client_errors_total"
    header = [f"# HELP {name} Crashed client screens, by build/route.", f"# TYPE {name} counter"]
    counts = cast(dict[str, str], await redis_client.hgetall(_CLIENT_ERRORS_KEY))
    if not counts:
        return []
    lines: list[str] = []
    for field, raw in counts.items():
        try:
            n = int(raw)
        except ValueError:
            continue
        build, _, route = field.partition(" ")
        lines.append(f"{name}{_prom_labels({'build': build, 'route': route})} {n}")
    return header + lines if lines else []


def _prom_gauge_lines(name: str, prefix: str, obj: Any) -> list[str]:
    """Плоские `_gauge` строки Prometheus из вложенного dict числовых значений.

    Ключи вложенности склеиваются `_` в имя метрики (`system_redis_ping_ms`); нечисловые
    и булевы листья (строки статуса, флаги) пропускаются — Prometheus гейджи это числа.
    """
    lines: list[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            lines.extend(_prom_gauge_lines(name, f"{prefix}_{key}" if prefix else key, value))
        return lines
    if isinstance(obj, bool) or not isinstance(obj, (int, float)):
        return []
    metric_name = f"{name}_{prefix}" if prefix else name
    return [f"{metric_name} {obj}"]


async def _prom_system_gauges() -> list[str]:
    snapshot = await collect_snapshot()
    snapshot.pop("ts", None)
    lines = _prom_gauge_lines("system", "", snapshot)
    if not lines:
        return []
    return [
        "# HELP system Infrastructure snapshot gauges "
        "(transcode queue, presence, redis, disk, db pool).",
        "# TYPE system gauge",
        *lines,
    ]


async def render_prometheus() -> str:
    """Текст в формате Prometheus exposition из текущих агрегатов Redis.

    Один проход по всем существующим сериям (HTTP, медиа, клиентский RUM, инфра-
    гейджи) — ничего нового не собирается, только переформатируется то, что уже
    копят `record_*`/`collect_snapshot`. См. `GET /metrics` в `app/main.py`.
    """
    blocks: list[list[str]] = []
    if settings.http_metrics_enabled:
        blocks.append(
            await _prom_histograms_by_prefix(
                "http_request_duration_ms", _HTTP_DUR_PREFIX, ("method", "route")
            )
        )
        blocks.append(await _prom_http_status_counters())
        blocks.append(
            await _prom_histograms_by_prefix(
                "http_scenario_duration_ms", _HTTP_SCENARIO_PREFIX, ("scenario",)
            )
        )
    if settings.media_metrics_enabled:
        blocks.append(
            await _prom_histograms_by_prefix(
                "media_step_duration_ms", "metrics:media:", ("source", "op", "kind", "step")
            )
        )
    if settings.client_metrics_enabled:
        blocks.append(
            await _prom_histograms_by_prefix(
                "client_nav_duration_ms", _CLIENT_NAV_PREFIX, ("visit", "net", "step")
            )
        )
        blocks.append(
            await _prom_histograms_by_prefix(
                "client_scenario_duration_ms", _CLIENT_SCENARIO_PREFIX, ("scenario", "step")
            )
        )
        blocks.append(await _prom_client_bytes_counters())
        blocks.append(await _prom_client_error_counters())
    blocks.append(await _prom_system_gauges())

    lines = [line for block in blocks for line in block]
    return "\n".join(lines) + "\n" if lines else ""
