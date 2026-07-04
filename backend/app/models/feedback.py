"""Обращения из раздела «Поддержка»: предложить улучшение / сообщить об ошибке.

Доменные данные — админ разбирает обращения в панели «Управление», нужна история
и статус «разобрано». Поэтому Postgres, а не Redis (п.5 CLAUDE.md про эфемерное
состояние касается typing/presence/токенов, не журнала обращений).
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Feedback(Base):
    """Одно обращение пользователя. kind — тип (улучшение/баг), body — текст.

    resolved_at пуст, пока админ не отметил обращение разобранным.
    """

    __tablename__ = "feedback"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('improvement', 'bug')", name="feedback_kind_valid"
        ),
        # Лента для админа: сначала новые, нужен просмотр по created_at.
        Index("ix_feedback_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
