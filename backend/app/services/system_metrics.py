"""Снимок инфраструктурных гейджей «прямо сейчас» (измерительный слой, ARG-81).

Источники уже существуют в системе, но никем не читаются: длина очереди транскода и
застрявшие джобы лежат ключами в Redis, presence — множеством там же, состояние пула
соединений знает только SQLAlchemy, свободное место — только ядро. Этот модуль снимает
их одним проходом для админского `GET /api/metrics/system`.

Принципы:

* **Считаем на лету, ничего не копим в фоне.** Гейджей мало, запрос редкий (админ
  открыл экран), отдельный фоновый сборщик здесь не окупается.
* **Best-effort поблочно.** Упавший источник (Redis моргнул, путь недоступен) отдаёт
  `{"error": "..."}` в своём блоке, а не роняет весь снимок: диагностический эндпоинт
  обязан работать именно тогда, когда что-то сломалось.
* **Только чтение.** Механику очереди транскода не трогаем — смотрим её ключи снаружи.

Единственное, что модуль пишет, — базовая точка для скорости роста диска
(`metrics:system:disk`): разница с предыдущим снимком, без отдельного хранилища.
"""
import logging
import shutil
import time
from typing import Any, cast

from app.core.config import settings
from app.core.redis import redis_client
from app.db.session import engine
from app.services.transcode_queue import ATTEMPTS_KEY, INFLIGHT_KEY, PENDING_KEY
from app.ws.manager import manager

logger = logging.getLogger(__name__)

# Базовая точка для скорости роста диска: HASH {used_bytes, ts} предыдущего снимка.
DISK_BASELINE_KEY = "metrics:system:disk"
# Базовую точку сдвигаем не чаще этого интервала: два запроса подряд дали бы разницу
# в секунды и мусорную «скорость роста» с огромной погрешностью.
_DISK_BASELINE_MIN_AGE_SECONDS = 300
# Базовая точка живёт неделю: если админ не заходил дольше, честнее пересобрать её
# заново, чем считать среднее по неизвестно какому периоду.
_DISK_BASELINE_TTL_SECONDS = 7 * 24 * 3600


async def _transcode_queue() -> dict[str, Any]:
    """Состояние очереди транскода: ждут / в работе / застряли / с повторами.

    «Застряли» — джобы, висящие в `transcode:inflight` дольше claim-таймаута: воркер
    забрал и не закрыл (упал/завис). Их и так вернёт `reclaim_stale()`, но до сих пор
    это было видно только по логам — здесь это отдельное число.
    """
    now = time.time()
    pending = await redis_client.llen(PENDING_KEY)
    # inflight держит одну запись на активную джобу (одна на воркер) — hgetall дёшев.
    inflight = cast("dict[str, str]", await redis_client.hgetall(INFLIGHT_KEY))
    attempts = cast("dict[str, str]", await redis_client.hgetall(ATTEMPTS_KEY))

    stale = 0
    oldest_claim_age = 0.0
    for claimed_at in inflight.values():
        try:
            age = now - float(claimed_at)
        except ValueError:  # чужой/битый ключ не должен ронять снимок
            continue
        oldest_claim_age = max(oldest_claim_age, age)
        if age > settings.transcode_claim_timeout_seconds:
            stale += 1

    retrying = 0
    for raw in attempts.values():
        try:
            if int(raw) > 1:
                retrying += 1
        except ValueError:
            continue

    return {
        "pending": pending,
        "inflight": len(inflight),
        "stale": stale,
        "retrying": retrying,
        "oldest_claim_age_seconds": round(oldest_claim_age),
        "claim_timeout_seconds": settings.transcode_claim_timeout_seconds,
    }


async def _presence() -> dict[str, Any]:
    """Онлайн: сколько юзеров в `presence:online` (общее по всем воркерам) и сколько
    живых WS-соединений держит ЭТОТ процесс.

    Числа намеренно разной природы: online — глобальное множество в Redis, соединения
    — локальный реестр процесса (`ws/manager.py`). При нескольких воркерах второе
    число покажет только свою долю — это видно по имени поля.
    """
    return {
        "online_users": await redis_client.scard("presence:online"),
        "ws_connections_this_process": manager.connection_count(),
    }


def _db_pool() -> dict[str, Any]:
    """Состояние пула соединений к Postgres.

    ВАЖНО: `pool_size` в `app/db/session.py` НЕ задан — работает дефолт SQLAlchemy
    (5 постоянных + 10 overflow). Крутить его без цифр не нужно, но видеть — да:
    упёршийся в потолок пул выглядит как «внезапно всё встало» и ничем другим себя
    не проявляет. Поле `size` ниже и есть тот самый дефолт, а не заданное значение.

    Пул берём у синхронного движка (async-обёртка проксирует его же). Методы
    `size/checkedin/checkedout/overflow` есть у QueuePool, но не у NullPool/StaticPool —
    поэтому дёргаем через getattr, а не падаем на нестандартном пуле.
    """
    pool = engine.sync_engine.pool
    out: dict[str, Any] = {
        # Строковый статус SQLAlchemy как есть — на случай пула, у которого нет
        # привычных счётчиков; читается глазами.
        "status": pool.status(),
        # pool_size не задан в session.py → это дефолт SQLAlchemy, не наша настройка.
        "size_is_sqlalchemy_default": True,
    }
    for field, method in (
        ("size", "size"),
        ("checked_in", "checkedin"),
        ("checked_out", "checkedout"),
        ("overflow", "overflow"),
    ):
        fn = getattr(pool, method, None)
        if fn is None:
            continue
        try:
            out[field] = fn()
        except Exception:  # noqa: BLE001 — счётчик пула не важнее снимка
            continue
    max_overflow = getattr(pool, "_max_overflow", None)
    if isinstance(max_overflow, int):
        out["max_overflow"] = max_overflow
    return out


async def _redis_health() -> dict[str, Any]:
    """Redis: round-trip `PING` и использование памяти из `INFO memory`."""
    started = time.perf_counter()
    await redis_client.ping()
    ping_ms = (time.perf_counter() - started) * 1000

    info = await redis_client.info("memory")
    return {
        "ping_ms": round(ping_ms, 2),
        "used_memory_bytes": info.get("used_memory"),
        "used_memory_human": info.get("used_memory_human"),
        "used_memory_rss_bytes": info.get("used_memory_rss"),
        "used_memory_peak_bytes": info.get("used_memory_peak"),
        # 0 (или отсутствие) = потолок не задан, Redis растёт до предела хоста.
        "maxmemory_bytes": info.get("maxmemory"),
    }


async def _disk() -> dict[str, Any]:
    """Свободное место под медиа и скорость роста.

    Путь берётся из `METRICS_DISK_PATH` (дефолт `/`): том MinIO в бэкенд-контейнер не
    смонтирован, но лежит на той же файловой системе docker-хоста, так что свободное
    место — общий пул. Это оценка «сколько осталось всем», а не размер одного тома.

    Скорость роста считаем как разницу с предыдущим снимком, сохранённым в Redis
    (`metrics:system:disk`) — без отдельного хранилища. Пока базовой точки нет (первый
    вызов после рестарта Redis), `growth_bytes_per_hour` = null, а не выдуманный ноль.
    """
    usage = shutil.disk_usage(settings.metrics_disk_path)
    now = time.time()
    out: dict[str, Any] = {
        "path": settings.metrics_disk_path,
        "total_bytes": usage.total,
        "used_bytes": usage.used,
        "free_bytes": usage.free,
        "used_percent": round(usage.used / usage.total * 100, 1) if usage.total else 0.0,
        "growth_bytes_per_hour": None,
        "growth_window_seconds": None,
    }

    baseline = cast("dict[str, str]", await redis_client.hgetall(DISK_BASELINE_KEY))
    should_store = True
    if baseline:
        try:
            prev_used = float(baseline["used_bytes"])
            prev_ts = float(baseline["ts"])
        except (KeyError, ValueError):
            prev_used = prev_ts = 0.0
        elapsed = now - prev_ts
        if prev_ts and elapsed > 0:
            out["growth_bytes_per_hour"] = round(
                (usage.used - prev_used) / elapsed * 3600
            )
            out["growth_window_seconds"] = round(elapsed)
            # Пока база свежая — не сдвигаем её: иначе окно схлопнется до секунд
            # между двумя обновлениями экрана и цифра станет шумом.
            should_store = elapsed >= _DISK_BASELINE_MIN_AGE_SECONDS

    if should_store:
        await redis_client.hset(
            DISK_BASELINE_KEY,
            mapping={"used_bytes": str(usage.used), "ts": str(now)},
        )
        await redis_client.expire(DISK_BASELINE_KEY, _DISK_BASELINE_TTL_SECONDS)

    return out


async def collect_snapshot() -> dict[str, Any]:
    """Снимок всех инфраструктурных гейджей на момент запроса.

    Каждый блок изолирован: сбой одного источника отдаётся как `{"error": ...}` внутри
    своего блока, остальные собираются. Диагностика обязана отвечать в том числе тогда,
    когда часть инфраструктуры лежит.
    """
    snapshot: dict[str, Any] = {"ts": time.time()}
    collectors: tuple[tuple[str, Any], ...] = (
        ("transcode_queue", _transcode_queue),
        ("presence", _presence),
        ("redis", _redis_health),
        ("disk", _disk),
    )
    for name, collector in collectors:
        try:
            snapshot[name] = await collector()
        except Exception as exc:  # noqa: BLE001 — снимок отдаём даже частичный
            logger.exception("system metrics: collector %s failed", name)
            snapshot[name] = {"error": f"{type(exc).__name__}: {exc}"}
    try:
        snapshot["db_pool"] = _db_pool()
    except Exception as exc:  # noqa: BLE001
        logger.exception("system metrics: collector db_pool failed")
        snapshot["db_pool"] = {"error": f"{type(exc).__name__}: {exc}"}
    return snapshot
