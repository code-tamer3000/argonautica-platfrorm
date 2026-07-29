"""Выпускная анкета экспедиции.

Собирается один раз в конце потока: админ отмечает участников
(`users.survey_required`), платформа перекрывается экраном анкеты, после отправки
человек получает подарок — персональную PDF-книгу (`users.survey_gift_asset_id`).

Ответы лежат одним JSONB: анкета версионируется целиком (`version`), канон
вопросов живёт в коде (`app.services.survey_form`). Колонка на вопрос не нужна —
тот же приём, что в Каюте (docs/CABIN.md).
"""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SurveyResponse(Base):
    """Одна сданная анкета. На пользователя — не больше одной (unique)."""

    __tablename__ = "survey_responses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False, unique=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    answers: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # Явное согласие показывать отзыв публично с именем автора.
    publish_consent: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
