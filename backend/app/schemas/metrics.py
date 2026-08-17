"""Схемы приёма клиентских метрик медиа (измерительный слой, docs/FILES.md).

Клиент шлёт по одному трейсу на медиа-операцию: тип операции, вид медиа, размер,
тип сети и тайминги шагов. Значения клиентские — не доверенные: используем только
для наблюдения (лог + агрегаты), никаких решений по ним не принимаем.
"""
from typing import Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator

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


# ─────────────────────────── Клиентский RUM ───────────────────────────

ClientMetricKind = Literal["navigation", "room_open", "resources", "error"]
ClientVisit = Literal["first", "repeat"]

# Ограничители: значения приходят из браузера и не доверенные. Длины полей и число
# ключей в словарях режем на входе, чтобы клиент не мог ни раздуть лог, ни наплодить
# ключей в Redis. Лишнее отбрасывается молча — метрика не повод отвечать ошибкой.
_MAX_ENTRIES = 24
_MAX_MESSAGE = 500
_MAX_STACK = 4000


class ClientMetric(BaseModel):
    """Одно клиентское событие RUM. Набор полей зависит от `kind`.

    `navigation` — `steps` из Navigation Timing + `lcp`, разрезы `cold`/`net`;
    `room_open` — `steps` (request/ttfb/render) и `total_ms`;
    `resources` — `bytes` по типам медиа за заход `visit` в комнату;
    `error` — `message`/`stack`/`route`. Во всех — `build` (версия сборки).
    """

    kind: ClientMetricKind
    # Версия сборки фронта: без неё цифры до и после релиза смешиваются в кашу.
    build: str | None = None
    # Тип сети из navigator.connection.effectiveType (4g/3g/…), если доступен.
    net: str | None = None
    # Холодный заход (кэш service worker пуст) против тёплого.
    cold: bool | None = None
    # Роут SPA на момент события (путь, без query — там могли бы быть данные).
    route: str | None = None
    # Первый или повторный заход в ту же комнату (для kind=resources).
    visit: ClientVisit | None = None
    total_ms: float | None = Field(default=None, ge=0)
    steps: dict[str, float] = Field(default_factory=dict)
    bytes: dict[str, int] = Field(default_factory=dict)
    message: str | None = None
    stack: str | None = None

    # Длинное поле РЕЖЕМ, а не отвергаем: отказ уронил бы всю пачку (в ней ещё
    # десятки нормальных трейсов), а приёмник метрик обязан быть безобидным.
    @field_validator("build", "net", "route", "message", "stack", mode="before")
    @classmethod
    def _truncate(cls, v: object, info: ValidationInfo) -> object:
        if not isinstance(v, str):
            return v
        limits = {
            "build": 64,
            "net": 32,
            "route": 200,
            "message": _MAX_MESSAGE,
            "stack": _MAX_STACK,
        }
        return v[: limits.get(info.field_name or "", _MAX_MESSAGE)]

    @field_validator("steps")
    @classmethod
    def _sane_steps(cls, v: dict[str, float]) -> dict[str, float]:
        return {k[:32]: ms for k, ms in list(v.items())[:_MAX_ENTRIES] if ms >= 0}

    @field_validator("bytes")
    @classmethod
    def _sane_bytes(cls, v: dict[str, int]) -> dict[str, int]:
        return {k[:32]: n for k, n in list(v.items())[:_MAX_ENTRIES] if n >= 0}


class ClientMetricsBatch(BaseModel):
    """Пачка клиентских событий — та же механика очереди и `keepalive`, что у медиа."""

    items: list[ClientMetric] = Field(max_length=100)
