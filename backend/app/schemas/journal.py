"""Схемы для раздела Динамика (прогресс ДЗ / помилования)."""
from datetime import date
from typing import Literal

from pydantic import BaseModel

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
