"""Pydantic-схемы комнат и членства."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AddMemberRequest(BaseModel):
    """Добавляемый — существующий юзер платформы (по id). Роль всегда 'member'."""

    user_id: int


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    room_id: int
    user_id: int
    role_in_room: str
    joined_at: datetime
