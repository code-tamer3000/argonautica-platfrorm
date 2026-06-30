"""Pydantic-схемы календаря (SPEC §4.10).

Событие либо общее (project-wide, `room_id=None`), либо привязано к комнате/каналу.
Создаёт/правит/удаляет только admin; участники читают по доступу к комнате.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class CalendarEventCreate(BaseModel):
    title: str
    description: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    room_id: int | None = None  # None = общее событие проекта

    @model_validator(mode="after")
    def _check_dates(self) -> "CalendarEventCreate":
        if self.ends_at is not None and self.ends_at < self.starts_at:
            raise ValueError("ends_at must be >= starts_at")
        return self


class CalendarEventUpdate(BaseModel):
    """Частичное обновление. `room_id` неизменяем (смена scope не предусмотрена)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None


class CalendarEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    starts_at: datetime
    ends_at: datetime | None
    all_day: bool
    room_id: int | None
    created_by: int
    created_at: datetime
