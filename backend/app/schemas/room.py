"""Pydantic-схемы комнат и членства."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

RoomType = Literal["dm", "group", "channel"]


class CreateRoomRequest(BaseModel):
    """Создание комнаты. Поля зависят от типа (валидируются в эндпоинте):
    dm → peer_id; group/channel → name.
    """

    type: RoomType
    name: str | None = None
    peer_id: int | None = None


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    name: str | None
    avatar_url: str | None
    created_at: datetime
    unread_count: int = 0
    is_personal: bool = False
    is_news: bool = False
    created_by: int = 0
    peer_id: int | None = None  # заполняется только для type='dm'
    # Комната подгруппы потока: узел сетки и его задача. Клиент вешает на такую
    # комнату виджет голосования за общую фразу. None у обычных комнат.
    stream_node_id: int | None = None
    stream_task_id: int | None = None


class AddMemberRequest(BaseModel):
    """Добавляемый — существующий юзер платформы (по id). Роль всегда 'member'."""

    user_id: int


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    room_id: int
    user_id: int
    role_in_room: str
    joined_at: datetime
