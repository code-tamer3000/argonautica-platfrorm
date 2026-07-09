"""Pydantic-схемы уведомлений (колокольчик + всплывающие тосты)."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

NotificationKind = Literal[
    "dm", "reply", "news", "journal_missed", "cabin_granted", "admin"
]


class NotificationOut(BaseModel):
    """Одно уведомление. actor_name/preview кладём сразу — тост рисуется без догрузки.

    Аватар автора фронт берёт из своего users-map по actor_id (там он уже с
    presigned-URL), поэтому здесь его не дублируем. У системных уведомлений
    (cabin_granted) actor/message пусты. Для админ-рассылки (admin) задан title
    (+ preview из тела). `journal_missed`/`ref_date` — легаси, больше не создаются.
    """

    id: int
    kind: NotificationKind
    room_id: int | None
    message_id: int | None
    actor_id: int | None
    actor_name: str | None
    preview: str | None
    ref_date: date | None
    title: str | None = None
    created_at: datetime
    read_at: datetime | None


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread_count: int


class MarkReadRequest(BaseModel):
    """Отметить прочитанными. up_to_id=None → все; иначе все с id <= up_to_id."""

    up_to_id: int | None = None
