"""Сообщения, вложения, закрепления. Треды — здесь же (плоские, стиль Slack)."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Message(Base):
    """Центральная таблица. id монотонный (BIGSERIAL) — нужно для статусов прочтения."""

    __tablename__ = "messages"
    __table_args__ = (
        # Лента комнаты и открытый тред — оба запроса по этому индексу.
        Index(
            "ix_messages_room_thread_created",
            "room_id",
            "thread_root_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("rooms.id"), nullable=False
    )
    sender_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    content: Mapped[str | None] = mapped_column(Text)  # NULL, если только стикер/вложение
    # NULL = верхний уровень; иначе указывает на КОРЕНЬ треда (правило плоскости).
    thread_root_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("messages.id")
    )
    sticker_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("stickers.id")
    )
    # Репост в новостной канал: исходный автор сообщения (для атрибуции «переслано от X»).
    # NULL = обычное (не пересланное) сообщение.
    forwarded_from_sender_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id")
    )
    # Денормализация на корневом сообщении — «N ответов» без пересчёта.
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # мягкое удаление


class MessageAttachment(Base):
    """Связь сообщение -> вложения (многие-ко-многим)."""

    __tablename__ = "message_attachments"

    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id"), primary_key=True
    )
    media_asset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media_assets.id"), primary_key=True
    )


class PinnedMessage(Base):
    """Закреплённые сообщения. Отдельная таблица — несколько закреплённых, кто/когда."""

    __tablename__ = "pinned_messages"

    room_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("rooms.id"), primary_key=True
    )
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id"), primary_key=True
    )
    pinned_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    pinned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
