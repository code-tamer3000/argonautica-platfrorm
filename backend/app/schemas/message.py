"""Pydantic-схемы сообщений, тредов и статусов прочтения."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.media import AttachmentOut


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
    forwarded_from_sender_id: int | None
    reply_count: int
    # Сколько ответов в треде этого корня непрочитано текущим зрителем (id ответа >
    # его last_read_message_id). Считается только для корней ленты; в остальных
    # местах (сам тред, вложенные) — 0. Денормализацией не храним — считаем на чтение.
    unread_reply_count: int = 0
    last_reply_at: datetime | None
    created_at: datetime
    edited_at: datetime | None
    # attachment_ids оставлен для обратной совместимости (старые клиенты); новые
    # клиенты используют attachments с готовыми presigned-URL и превью.
    attachment_ids: list[int] = []
    attachments: list[AttachmentOut] = []


class ThreadOut(BaseModel):
    """Открытый тред: сам корень + его ответы (плоско, без вложенности)."""

    root: MessageOut
    replies: list[MessageOut]


class EditMessageRequest(BaseModel):
    """Правка текста сообщения. Пустой текст недопустим (для очистки — удаление)."""

    content: str

    @model_validator(mode="after")
    def _not_blank(self) -> "EditMessageRequest":
        if not self.content.strip():
            raise ValueError("content must not be blank")
        return self


class PinnedOut(BaseModel):
    """Закрепление вместе с полезной нагрузкой сообщения."""

    room_id: int
    message_id: int
    pinned_by: int
    pinned_at: datetime
    message: MessageOut


class ReadRequest(BaseModel):
    last_read_message_id: int


class ReadStateOut(BaseModel):
    room_id: int
    last_read_message_id: int | None
    unread_count: int
