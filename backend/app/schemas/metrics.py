"""Схемы приёма клиентских метрик медиа (измерительный слой, docs/FILES.md).

Клиент шлёт по одному трейсу на медиа-операцию: тип операции, вид медиа, размер,
тип сети и тайминги шагов. Значения клиентские — не доверенные: используем только
для наблюдения (лог + агрегаты), никаких решений по ним не принимаем.
"""
from typing import Literal

from pydantic import BaseModel, Field

MetricOp = Literal["upload", "download"]
MetricKind = Literal["image", "video", "file", "audio"]


class MediaMetric(BaseModel):
    op: MetricOp
    kind: MetricKind
    # Размер объекта в байтах (клиентский; для группировки, не для контроля).
    size: int | None = Field(default=None, ge=0)
    # Тип сети из navigator.connection.effectiveType (4g/3g/wifi/…), если доступен.
    net: str | None = None
    # Полная длительность операции глазами клиента (мс).
    total_ms: float = Field(ge=0)
    # Тайминги отдельных шагов, мс: presign_ms/put_ms/confirm_ms/poster_ms (upload);
    # presign_ms/load_ms (download). Ключи произвольны — сохраняем как есть.
    steps: dict[str, float] = Field(default_factory=dict)


class MetricsBatch(BaseModel):
    """Пачка трейсов — клиент копит и шлёт разом (реже round-trip'ов, keepalive)."""

    items: list[MediaMetric] = Field(max_length=100)
