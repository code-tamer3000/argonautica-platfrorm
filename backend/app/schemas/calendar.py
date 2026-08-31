"""Pydantic-схемы календаря (SPEC §4.10).

Событие либо общее для всех потоков/тарифов (NULL/пусто), либо изолировано по
потоку и тарифу — тот же двойной фильтр, что у КБ-материалов и common-задач
(ARG-96/ARG-111). Создаёт/правит/удаляет только admin; участники читают по
видимости (+ по доступу к задаче, если событие — синхронизированный дедлайн).
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class CalendarEventCreate(BaseModel):
    title: str
    description: str | None = None
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    intake_id: int | None = None  # None = общее событие всех потоков
    plan_ids: list[int] = []  # пусто = все тарифы потока

    @model_validator(mode="after")
    def _check_dates(self) -> "CalendarEventCreate":
        if self.ends_at is not None and self.ends_at < self.starts_at:
            raise ValueError("ends_at must be >= starts_at")
        return self


class CalendarEventUpdate(BaseModel):
    """Частичное обновление. Применяем только переданные (exclude_unset) поля."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    intake_id: int | None = None
    plan_ids: list[int] | None = None


class CalendarEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    starts_at: datetime
    ends_at: datetime | None
    all_day: bool
    # Заполнено = автоуправляемое дедлайн-событие задачи (см. services/tasks.py).
    task_id: int | None = None
    created_by: int
    created_at: datetime
    intake_id: int | None = None
    plan_ids: list[int] = []
    # --- Обогащение дедлайн-событий задачи (заполняется только при task_id) ---
    # Выполнил ли задачу текущий юзер (его назначение принято). Для участника —
    # чтобы в календаре показать выполненный дедлайн так же, как в разделе задач.
    task_done: bool = False
    # Прогресс проверки для админа: сдали / всего адресатов. Для участника — None
    # (чужой прогресс не раскрываем).
    task_submitted_count: int | None = None
    task_total_count: int | None = None
