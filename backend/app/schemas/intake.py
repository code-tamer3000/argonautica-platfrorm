"""Pydantic-схемы наборов (когорт участников)."""
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class IntakeCreateRequest(BaseModel):
    """Вход POST /api/admin/intakes. Дата старта — единственное, что задаёт набор."""

    model_config = ConfigDict(extra="forbid")

    starts_on: date


class IntakeOut(BaseModel):
    """Набор для админки. `user_count` — сколько участников к нему привязано.

    Активным считается набор с максимальной `starts_on` (см. docs/DATA_MODEL.md):
    явного статуса «открыт/закрыт» у набора нет.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    starts_on: date
    created_at: datetime
    user_count: int = 0
