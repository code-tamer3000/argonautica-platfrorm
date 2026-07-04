"""Снимок технических метрик сервера для админ-мониторинга.

Читаем напрямую из `/proc` (Linux/Docker) — без внешних зависимостей и почти без
нагрузки (несколько мелких файлов на запрос). Мгновенные скорости (CPU %, сеть)
считаются как дельта между текущим и предыдущим снимком: сырые счётчики предыдущего
снимка держим в Redis (`admin:metrics:prev`), поэтому дельта корректна и между
воркерами, и без «сна» внутри запроса. Первый вызов (нет prev / prev протух) отдаёт
скорости нулями — следующий poll уже покажет реальные значения.

Не Linux (нет `/proc`) — деградируем мягко: поля, которые не прочитать, отдаём None.
"""
from __future__ import annotations

import json
import time
from typing import Any

from redis.asyncio import Redis

_PREV_KEY = "admin:metrics:prev"
_PREV_TTL = 30  # сек; старее — считаем скорости с чистого листа
_PROCESS_START = time.time()


def _read_cpu() -> tuple[int, int] | None:
    """Суммарные и idle-джиффи из /proc/stat (первая строка `cpu`)."""
    try:
        with open("/proc/stat") as f:
            parts = f.readline().split()
    except OSError:
        return None
    if not parts or parts[0] != "cpu":
        return None
    nums = [int(x) for x in parts[1:]]
    idle = nums[3] + (nums[4] if len(nums) > 4 else 0)  # idle + iowait
    return sum(nums), idle


def _read_net() -> tuple[int, int] | None:
    """Суммарные rx/tx байты по всем интерфейсам кроме loopback (/proc/net/dev)."""
    try:
        with open("/proc/net/dev") as f:
            lines = f.readlines()[2:]
    except OSError:
        return None
    rx = tx = 0
    for line in lines:
        name, _, rest = line.partition(":")
        if name.strip() == "lo":
            continue
        cols = rest.split()
        if len(cols) >= 9:
            rx += int(cols[0])
            tx += int(cols[8])
    return rx, tx


def _read_mem() -> dict[str, int] | None:
    """MemTotal/MemAvailable из /proc/meminfo (в байтах)."""
    try:
        vals: dict[str, int] = {}
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                if key in ("MemTotal", "MemAvailable"):
                    vals[key] = int(rest.split()[0]) * 1024
                    if len(vals) == 2:
                        break
    except OSError:
        return None
    if "MemTotal" not in vals or "MemAvailable" not in vals:
        return None
    total = vals["MemTotal"]
    used = total - vals["MemAvailable"]
    return {"total": total, "used": used}


def _read_loadavg() -> list[float] | None:
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
        return [float(parts[0]), float(parts[1]), float(parts[2])]
    except (OSError, ValueError, IndexError):
        return None


async def _redis_stats(redis: Redis) -> dict[str, Any]:
    try:
        info = await redis.info()
        return {
            "connected_clients": int(info.get("connected_clients", 0)),
            "used_memory": int(info.get("used_memory", 0)),
        }
    except Exception:
        return {"connected_clients": None, "used_memory": None}


def _db_pool_stats() -> dict[str, Any]:
    try:
        from app.db.session import engine

        pool = engine.pool
        return {"size": pool.size(), "checked_out": pool.checkedout()}  # type: ignore[attr-defined]
    except Exception:
        return {"size": None, "checked_out": None}


async def collect(redis: Redis) -> dict[str, Any]:
    """Собрать снимок метрик. Скорости — дельта к prev-снимку из Redis."""
    from app.ws.manager import manager

    now = time.time()
    cpu = _read_cpu()
    net = _read_net()

    prev_raw = await redis.get(_PREV_KEY)
    prev = json.loads(prev_raw) if prev_raw else None

    cpu_percent: float | None = None
    net_tx = net_rx = 0.0
    if prev and (now - prev["ts"]) > 0.05:
        dt = now - prev["ts"]
        if cpu and prev.get("cpu"):
            d_total = cpu[0] - prev["cpu"][0]
            d_idle = cpu[1] - prev["cpu"][1]
            if d_total > 0:
                cpu_percent = round(max(0.0, (1 - d_idle / d_total)) * 100, 1)
        if net and prev.get("net"):
            net_rx = max(0.0, (net[0] - prev["net"][0]) / dt)
            net_tx = max(0.0, (net[1] - prev["net"][1]) / dt)

    # Сохраняем текущие сырые счётчики как базу для следующей дельты.
    await redis.set(
        _PREV_KEY,
        json.dumps({"ts": now, "cpu": cpu, "net": net}),
        ex=_PREV_TTL,
    )

    return {
        "ts": now,
        "uptime_seconds": now - _PROCESS_START,
        "cpu_percent": cpu_percent,
        "load_avg": _read_loadavg(),
        "mem": _read_mem(),
        "net": {"tx_bytes_sec": round(net_tx), "rx_bytes_sec": round(net_rx)},
        "ws_connections": manager.connection_count(),
        "redis": await _redis_stats(redis),
        "db_pool": _db_pool_stats(),
    }
