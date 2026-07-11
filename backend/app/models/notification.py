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

    От сообщения (dm/reply/news) — заданы actor_id/message_id. cabin_granted —
    actor_id/message_id/room_id пусты (клик ведёт в /cabin). Админ-рассылка
    (admin) — заголовок в title, room/message/actor пусты.

    `journal_missed` больше не генерируется (снято — раздражало пользователей);
    значение оставлено в CHECK ради обратной совместимости старых строк, новые не
    создаются. `ref_date` под него сохранён на случай возврата, сейчас не пишется.
    """

    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('dm', 'reply', 'news', 'mention', 'journal_missed', "
            "'cabin_granted', 'admin')",
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
    # message_id/actor_id пусты у системных уведомлений (cabin_granted/admin).
    message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("messages.id")
    )
    actor_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id")
    )
    # Легаси-поле бывшего journal_missed (день дневника). Больше не пишется.
    ref_date: Mapped[date | None] = mapped_column(Date)
    # Заголовок админ-рассылки (kind='admin'); у остальных видов пуст. Тело —
    # в общий поток превью через отдельную строку не выносим: текст рассылки лежит
    # прямо здесь (title) + preview (первые строки тела).
    title: Mapped[str | None] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
