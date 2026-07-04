"""Частые вопросы раздела «Поддержка»: вопрос + ответ/инструкция.

Доменные данные — админ ведёт список в панели «Управление», участники читают.
Поэтому Postgres (п.5 CLAUDE.md про эфемерное состояние касается typing/presence/
токенов, не справочного контента).
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FaqItem(Base):
    """Одна запись FAQ. sort_order задаёт порядок в списке (меньше — выше)."""

    __tablename__ = "faq_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    # Ручной порядок вывода; при равенстве — по id (стабильно).
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
