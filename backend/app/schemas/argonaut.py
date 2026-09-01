"""Pydantic-схемы раздела «Аргонавты» (ростер потока + профиль участника).

См. docs/ARGONAUTS.md: состав списка — весь intake смотрящего, кроме наблюдателей;
`tasks_done`/`tasks` считаются только по common-задачам, видимым смотрящему (тот же
двойной фильтр поток+тариф, что и в разделе «Задачи»). `expedition_feat` — текст
последней сдачи именованной задачи «Освобождаем оперативку» (см. EXPEDITION_FEAT_TASK_TITLE
в api/argonauts.py); `expedition_feat_task_id`/`_status` — чтобы фронт мог дать
владельцу профиля отредактировать её через уже существующий TaskComposer.
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
    expedition_feat: str | None = None
    # id задачи + статус НАЗНАЧЕНИЯ ЦЕЛЕВОГО юзера (не смотрящего) — нужны фронту,
    # чтобы на СВОЕЙ странице показать TaskComposer (POST /api/tasks/{id}/submissions,
    # уже готовый компонент раздела «Задачи») и отредактировать «Подвиг».
    # null у обоих — задачи нет/не видна смотрящему, либо у юзера нет назначения.
    expedition_feat_task_id: int | None = None
    expedition_feat_status: str | None = None
