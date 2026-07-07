"""Уведомления пользователю: ответ на его сообщение, личка, пост в новостях.

Доменные данные (нужна история для «колокольчика», переживание перезагрузки и
будущий web-push), поэтому Postgres, а не Redis — п.5 CLAUDE.md про эфемерное
состояние касается typing/presence/токенов, не журнала уведомлений.
"""
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Notification(Base):
    """Одно уведомление получателю `user_id`.

    От сообщения (dm/reply/news) — заданы actor_id/message_id. Системное
    (journal_missed — вчерашний день дневника не закрыт) — actor_id/message_id
    пусты, зато задан ref_date (какой день); room_id указывает на личный дневник.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('dm', 'reply', 'news', 'journal_missed', 'cabin_granted')",
            name="notification_kind_valid",
        ),
        # Лента колокольчика: последние уведомления пользователя.
        Index("ix_notifications_user_id_id", "user_id", "id"),
        # Счётчик непрочитанных — только по непрочитанным строкам (partial index).
        Index(
            "ix_notifications_unread",
            "user_id",
            postgresql_where=text("read_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # room_id пуст у уведомлений без привязки к комнате (cabin_granted — доступ к Каюте).
    room_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("rooms.id"))
    # message_id/actor_id пусты для системных уведомлений (journal_missed).
    message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("messages.id")
    )
    actor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id")
    )
    # Для journal_missed — день дневника, к которому относится уведомление (дедуп).
    ref_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
