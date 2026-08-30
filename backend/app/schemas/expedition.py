"""Круг Экспедиции: расписание этапов потока, замки-гексаграммы, стартовый агрегат."""
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.calendar import CalendarEventOut
from app.schemas.journal import JournalStructureOut, RecentDay
from app.schemas.notification import NotificationOut
from app.schemas.task import TaskWithStatusOut

StageKind = Literal["balance", "air", "fire", "water", "earth", "final"]
Element = Literal["air", "fire", "water", "earth"]
LockState = Literal["locked", "unlockable", "entered", "revealed"]


class StageIn(BaseModel):
    """Один этап расписания. `task_id=None` — стихия без привязанного задания
    (замок останавливается на «введён», до «раскрыт» не доходит); `balance`/`final`
    task_id не несут вовсе (не провалидировано здесь — проверяется в эндпоинте, где
    есть доступ к остальным элементам списка)."""

    kind: StageKind
    air_date: date
    air_time: time | None = None
    task_id: int | None = None


class StagesUpdate(BaseModel):
    """PUT целиком: расписание — фиксированные шесть строк, частичный PATCH только
    плодит несогласованные состояния (пропущенный этап посреди графика)."""

    model_config = ConfigDict(extra="forbid")

    stages: list[StageIn] = Field(min_length=6, max_length=6)


class StageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: StageKind
    air_date: date
    air_time: time | None
    task_id: int | None


class StageSpanOut(StageOut):
    """Этап + его вычисленное место в круге (не хранится, см. layout_stages)."""

    day_from: int
    day_to: int


class LockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    element: Element
    key_number: int
    hexagram: str
    created_at: datetime
    updated_at: datetime


class LockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key_number: int = Field(ge=1, le=64)


class ExpeditionOut(BaseModel):
    """Круг: расписание с раскладкой по дням + текущее состояние каждого замка."""

    total_days: int
    today: int | None  # 1..total_days; None — до старта или после конца окна
    stages: list[StageSpanOut]
    days: list[RecentDay]  # весь круг, не ±окно (см. dynamics._recent_days)
    locks: dict[Element, LockOut]
    lock_states: dict[Element, LockState]


class NewsPreviewOut(BaseModel):
    room_id: int
    author_name: str
    preview: str
    created_at: datetime


class DashboardOut(BaseModel):
    """Один агрегат для стартового экрана — вместо семи запросов на первом же
    рендере после логина (там, где меряется LCP клиентским RUM). Все поля собраны
    вызовом уже существующих сервисных функций, без новой бизнес-логики."""

    expedition: ExpeditionOut | None  # None — нет потока/расписания (напр. админ)
    journal: JournalStructureOut | None  # None — участнику Динамика недоступна
    journal_today_done: bool
    # Выпускник / закрытое окно набора — дневник виден, но форма отправки закрыта
    # (сервер и так ответит 403; фронт по этому флагу прячет кнопку, тот же приём,
    # что MyDynamicsOut.window_closed).
    journal_locked: bool
    upcoming_events: list[CalendarEventOut]
    active_tasks: list[TaskWithStatusOut]
    notifications: list[NotificationOut]
    unread_notifications: int
    news_preview: NewsPreviewOut | None
