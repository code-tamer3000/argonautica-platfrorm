"""Схемы для раздела Динамика (прогресс ДЗ / помилования)."""
from datetime import date
from typing import Literal

from pydantic import BaseModel

DayStatus = Literal["closed", "missed", "pardoned", "today_open", "today_closed", "before_start"]


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
    recent_days: list[RecentDay]


class PardonRequest(BaseModel):
    date: date
