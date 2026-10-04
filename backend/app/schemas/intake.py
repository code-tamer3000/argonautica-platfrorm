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
    # «Факел» для потока (ARG-169) — см. models/intake.py.
    graduation_popup_text: str | None = None
    torch_stub_text: str | None = None
    torch_kb_intake_id: int | None = None


class IntakeTorchRequest(BaseModel):
    """PATCH /api/admin/intakes/{id}/torch: тексты клуба потока и мост к базе знаний
    другого потока. Поле не передано — не меняется; пустая строка/null — сброс."""

    model_config = ConfigDict(extra="forbid")

    graduation_popup_text: str | None = None
    torch_stub_text: str | None = None
    torch_kb_intake_id: int | None = None
