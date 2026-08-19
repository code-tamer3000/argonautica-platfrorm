"""Pydantic-схемы наборов (когорт участников)."""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, model_validator


class IntakeCreateRequest(BaseModel):
    """Вход POST /api/admin/intakes. `ends_on` — дата закрытия окна набора (ARG-96):
    внутри [starts_on, ends_on] Динамика идёт как обычно, после — архив read-only.
    """

    model_config = ConfigDict(extra="forbid")

    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def _ends_after_starts(self) -> "IntakeCreateRequest":
        if self.ends_on <= self.starts_on:
            raise ValueError("ends_on must be after starts_on")
        return self


class IntakeUpdateRequest(BaseModel):
    """Частичная правка окна набора (только `ends_on` — `starts_on` без API,
    см. ARG-89)."""

    model_config = ConfigDict(extra="forbid")

    ends_on: date


class IntakeOut(BaseModel):
    """Набор для админки. `user_count` — сколько участников к нему привязано.

    Активным считается набор с максимальной `starts_on` (см. docs/DATA_MODEL.md):
    явного статуса «открыт/закрыт» у набора нет.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    starts_on: date
    ends_on: date
    created_at: datetime
    user_count: int = 0
