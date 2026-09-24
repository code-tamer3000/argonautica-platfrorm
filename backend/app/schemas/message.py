"""Pydantic-схемы сообщений, тредов и статусов прочтения."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.media import AttachmentOut, PlaylistOut

# Ссылка-референс из сообщения: на материал КБ или задачу.
RefKind = Literal["kb", "task"]

# Потолок вложений в одном сообщении («альбом»). Столько же показывает клиент одной
# сеткой (см. docs/MESSAGES.md); больше — уже не группа, а свалка в ленте.
MAX_ATTACHMENTS = 6

# Сниппет цитируемого сообщения в плашке «ответить цитатой» (Telegram-style).
QUOTE_PREVIEW_LEN = 140

# Чем рисовать плашку цитаты, если текста нет (сообщение — стикер/вложение/ref),
# либо оригинал недоступен (мягко удалён).
QuoteKind = Literal["text", "sticker", "attachment", "ref", "deleted"]


class SendMessageRequest(BaseModel):
    """Отправка сообщения. content nullable, но сообщение должно нести хоть что-то:
    текст, стикер, вложение или ссылку. reply_to_message_id — ответ в тред (см. эндпоинт).
    quoted_message_id — ответ ЦИТАТОЙ (Telegram-style): презентационная ссылка на
    сообщение той же комнаты, ортогональная треду (не путать с reply_to_message_id,
    который означает «id корня треда»; см. docs/MESSAGES.md «Quotes»).
    ref_kind/ref_id — опциональная ссылка на материал КБ / задачу (одна на сообщение).
    """

    content: str | None = None
    sticker_id: int | None = None
    attachment_ids: list[int] = []
    # Плейлист-вложение (docs/FILES.md «Плейлист») — уже созданный через
    # POST /api/media/playlists, ортогонален attachment_ids (одно на сообщение).
    playlist_id: int | None = None
    reply_to_message_id: int | None = None
    quoted_message_id: int | None = None
    ref_kind: RefKind | None = None
    ref_id: int | None = None

    @model_validator(mode="after")
    def _validate(self) -> "SendMessageRequest":
        # Ссылка: оба поля вместе или ни одного.
        if (self.ref_kind is None) != (self.ref_id is None):
            raise ValueError("ref_kind and ref_id must be set together")
        # Повтор одного и того же ассета в списке — не ошибка клиента, а лишняя строка:
        # message_attachments уникальна по (message_id, media_asset_id), поэтому дубли
        # схлопываем здесь (иначе INSERT падал бы 500-й).
        self.attachment_ids = list(dict.fromkeys(self.attachment_ids))
        if len(self.attachment_ids) > MAX_ATTACHMENTS:
            raise ValueError(f"At most {MAX_ATTACHMENTS} attachments per message")
        has_text = bool(self.content and self.content.strip())
        has_ref = self.ref_kind is not None
        if not (
            has_text
            or self.sticker_id is not None
            or self.attachment_ids
            or self.playlist_id is not None
            or has_ref
        ):
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


class QuotedMessageOut(BaseModel):
    """Развёрнутая цитата для зрителя. Резолвится на КАЖДОМ чтении (не снимок на
    момент отправки) — правка оригинала автоматически видна во всех плашках.
    """

    id: int
    sender_id: int | None  # None у удалённого/недоступного — автора не раскрываем
    preview: str | None  # текст без inline-маркеров/journal-маркера, <= QUOTE_PREVIEW_LEN
    kind: QuoteKind
    thread_root_id: int | None  # если оригинал сам внутри треда — куда переходить
    deleted: bool


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
    # Плейлист-вложение, разрешённый в готовые presigned-URL. None = вложения нет.
    playlist: PlaylistOut | None = None
    # Ссылка на материал КБ / задачу, разрешённая для зрителя. None = ссылки нет.
    ref: MessageRefOut | None = None
    # Цитируемое сообщение (Telegram-style «ответить»), разрешённое для зрителя.
    # None = цитаты нет. Ортогонально thread_root_id — см. docs/MESSAGES.md «Quotes».
    quote: QuotedMessageOut | None = None
    # Реакция (один фиксированный образ, MVP): общий счётчик + реагировал ли зритель.
    reaction_count: int = 0
    reacted_by_me: bool = False


class ThreadOut(BaseModel):
    """Открытый тред: сам корень + его ответы (плоско, без вложенности)."""

    root: MessageOut
    replies: list[MessageOut]


class EditMessageRequest(BaseModel):
    """Правка сообщения: текст и/или состав вложений. Оба поля опциональны и
    независимы — присутствие поля в запросе (не его значение) решает, что менять
    (см. `model_fields_set` в эндпоинте): отсутствующее поле остаётся как было,
    `content: null`/`""` стирает текст, `attachment_ids: []` снимает все вложения.
    Хотя бы одно поле должно быть передано, и результат должен нести что-то
    (текст, стикер, вложение или ref) — иначе 400 в эндпоинте.
    """

    content: str | None = None
    attachment_ids: list[int] | None = None

    @model_validator(mode="after")
    def _validate(self) -> "EditMessageRequest":
        if self.attachment_ids is not None:
            # Тот же дедуп, что в SendMessageRequest — message_attachments уникальна
            # по (message_id, media_asset_id).
            self.attachment_ids = list(dict.fromkeys(self.attachment_ids))
            if len(self.attachment_ids) > MAX_ATTACHMENTS:
                raise ValueError(f"At most {MAX_ATTACHMENTS} attachments per message")
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
