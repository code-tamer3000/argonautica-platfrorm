"""Pydantic-схемы сообщений, тредов и статусов прочтения."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator


class SendMessageRequest(BaseModel):
    """Отправка сообщения. content nullable, но сообщение должно нести хоть что-то:
    текст, стикер или вложение. reply_to_message_id — ответ в тред (см. эндпоинт).
    """

    content: str | None = None
    sticker_id: int | None = None
    attachment_ids: list[int] = []
    reply_to_message_id: int | None = None

    @model_validator(mode="after")
    def _must_carry_something(self) -> "SendMessageRequest":
        has_text = bool(self.content and self.content.strip())
        if not (has_text or self.sticker_id is not None or self.attachment_ids):
            raise ValueError("Message must carry text, a sticker or attachments")
        return self


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    room_id: int
    sender_id: int
    content: str | None
    sticker_id: int | None
    thread_root_id: int | None
    reply_count: int
    last_reply_at: datetime | None
    created_at: datetime
    edited_at: datetime | None
    attachment_ids: list[int] = []


class ThreadOut(BaseModel):
    """Открытый тред: сам корень + его ответы (плоско, без вложенности)."""

    root: MessageOut
    replies: list[MessageOut]


class ReadRequest(BaseModel):
    last_read_message_id: int


class ReadStateOut(BaseModel):
    room_id: int
    last_read_message_id: int | None
    unread_count: int
