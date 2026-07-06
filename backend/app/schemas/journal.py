"""Схемы для раздела Динамика (прогресс ДЗ / помилования) + структура дневника."""
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

InputType = Literal["text", "title"]

DayStatus = Literal[
    "closed", "credited", "missed", "pardoned",
    "today_open", "today_closed", "before_start", "upcoming",
]


class RecentDay(BaseModel):
    date: date
    status: DayStatus


class MyDynamicsOut(BaseModel):
    streak: int
    overdue_dates: list[date]
    pardons_used: int
    pardons_remaining: int
    today_progress: list[str]
    program_start: date


class UserDynamicsOut(BaseModel):
    user_id: int
    display_name: str
    username: str
    avatar_url: str | None
    streak: int
    overdue_count: int
    pardons_used: int
    active_today: bool
    journal_today: bool
    recent_days: list[RecentDay]


class DynamicsSummary(BaseModel):
    total_participants: int
    active_today: int
    journal_today: int
    no_overdue: int
    avg_streak: float


class AdminDynamicsOut(BaseModel):
    summary: DynamicsSummary
    users: list[UserDynamicsOut]


class PardonRequest(BaseModel):
    date: date


class AdminCreditRequest(BaseModel):
    """Админ зачитывает/снимает день пользователю."""
    user_id: int
    date: date
    credited: bool = True


# ─── Структура дневника (задания) ───────────────────────────────────────────

class JournalSectionOut(BaseModel):
    key: str
    emoji: str
    label: str
    heading: str
    placeholder: str
    input_type: InputType
    position: int


class JournalStructureOut(BaseModel):
    """Активное задание для текущего дня — для виджета и композера участника."""
    program_id: int | None
    starts_on: date | None
    title: str | None
    description: str | None
    sections: list[JournalSectionOut]


class JournalSectionIn(BaseModel):
    # key — стабильный slug, которым помечается запись (<!--journal:key-->).
    key: str = Field(pattern=r"^[a-z0-9_]+$", min_length=1, max_length=32)
    emoji: str = Field(default="", max_length=8)
    label: str = Field(min_length=1, max_length=64)
    heading: str = Field(default="", max_length=128)
    placeholder: str = Field(default="", max_length=200)
    input_type: InputType = "text"


class JournalProgramIn(BaseModel):
    starts_on: date
    title: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    sections: list[JournalSectionIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_keys(self) -> "JournalProgramIn":
        keys = [s.key for s in self.sections]
        if len(keys) != len(set(keys)):
            raise ValueError("Ключи разделов должны быть уникальны")
        return self


class JournalProgramUpdate(BaseModel):
    """PATCH: обновляются только присланные поля (см. model_fields_set)."""
    starts_on: date | None = None
    title: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    sections: list[JournalSectionIn] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _unique_keys(self) -> "JournalProgramUpdate":
        if self.sections is not None:
            keys = [s.key for s in self.sections]
            if len(keys) != len(set(keys)):
                raise ValueError("Ключи разделов должны быть уникальны")
        return self


class JournalProgramOut(BaseModel):
    id: int
    starts_on: date
    title: str | None
    description: str | None
    created_by: int | None
    sections: list[JournalSectionOut]
