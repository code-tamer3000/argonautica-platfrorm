"""Схема снимка технических метрик сервера (админ-мониторинг)."""
from pydantic import BaseModel


class MemMetrics(BaseModel):
    total: int
    used: int


class NetMetrics(BaseModel):
    tx_bytes_sec: int
    rx_bytes_sec: int


class RedisMetrics(BaseModel):
    connected_clients: int | None
    used_memory: int | None


class DbPoolMetrics(BaseModel):
    size: int | None
    checked_out: int | None


class ServerMetricsOut(BaseModel):
    """Мгновенный снимок нагрузки. Поля-скорости приходят от дельты к прошлому poll."""

    ts: float
    uptime_seconds: float
    cpu_percent: float | None
    load_avg: list[float] | None
    mem: MemMetrics | None
    net: NetMetrics
    ws_connections: int
    redis: RedisMetrics
    db_pool: DbPoolMetrics
