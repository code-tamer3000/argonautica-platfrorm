"""Pydantic-схемы сообщений, тредов и статусов прочтения."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.media import AttachmentOut

# Ссылка-референс из сообщения: на материал КБ или задачу.
RefKind = Literal["kb", "task"]


class SendMessageRequest(BaseModel):
    """Отправка сообщения. content nullable, но сообщение должно нести хоть что-то:
    текст, стикер, вложение или ссылку. reply_to_message_id — ответ в тред (см. эндпоинт).
    ref_kind/ref_id — опциональная ссылка на материал КБ / задачу (одна на сообщение).
    """

    content: str | None = None
    sticker_id: int | None = None
    attachment_ids: list[int] = []
    reply_to_message_id: int | None = None
    ref_kind: RefKind | None = None
    ref_id: int | None = None

    @model_validator(mode="after")
    def _validate(self) -> "SendMessageRequest":
        # Ссылка: оба поля вместе или ни одного.
        if (self.ref_kind is None) != (self.ref_id is None):
            raise ValueError("ref_kind and ref_id must be set together")
        has_text = bool(self.content and self.content.strip())
        has_ref = self.ref_kind is not None
        if not (has_text or self.sticker_id is not None or self.attachment_ids or has_ref):
            raise ValueError("Message must carry text, a sticker, attachments or a ref")
        return self


class MessageRefOut(BaseModel):
    """Разрешённая ссылка сообщения для зрителя. title/url считает сервер; available —
    есть ли у зрителя доступ к цели (иначе кнопка неактивна, заголовок не раскрывается).
    """

    kind: RefKind
    id: int
    title: str
    url: str
    available: bool


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
    # Ссылка на материал КБ / задачу, разрешённая для зрителя. None = ссылки нет.
    ref: MessageRefOut | None = None


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
