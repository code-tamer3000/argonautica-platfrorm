"""Pydantic-схемы раздела «Аргонавты» (ростер потока + профиль участника).

См. docs/ARGONAUTS.md: состав списка — весь intake смотрящего, кроме наблюдателей
и админов; `tasks_done`/`tasks` считаются только по common-задачам, видимым
смотрящему (тот же двойной фильтр поток+тариф, что и в разделе «Задачи»).
"""
from datetime import datetime

from pydantic import BaseModel


class ArgonautOut(BaseModel):
    """Одна плитка ростера."""

    id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    role: str
    plan_id: int | None = None
    plan_name: str | None = None
    tasks_done: int


class ArgonautTaskOut(BaseModel):
    """Одна строка в списке задач на странице участника."""

    task_id: int
    title: str
    status: str
    deadline_at: datetime | None = None
    reviewed_at: datetime | None = None


class ArgonautDetailOut(BaseModel):
    """Профиль участника + его видимые смотрящему задачи + ссылка на дневник."""

    id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None
    role: str
    plan_id: int | None = None
    plan_name: str | None = None
    tasks_done: int
    diary_room_id: int | None = None
    tasks: list[ArgonautTaskOut]
