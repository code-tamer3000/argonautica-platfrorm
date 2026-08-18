"""Состояние воронки бота приёма (ARG-92): анкета → тариф → чек → одобрение.

Persistent-состояние в Postgres (не sqlite, не Redis — воронка переживает рестарт
контейнера и не эфемерна, в отличие от typing/presence, см. ADR-013). Эфемерное
«жду ответа на вопрос» (`intakebot:await_q:*`) по-прежнему в Redis — оно и должно
жить только пока чат открыт.
"""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Шаги воронки. Переходы строго по порядку, кроме «Задать вопрос» — она не меняет status.
STATUS_AWAITING_ABOUT = "awaiting_about"  # /start отправлен, ждём рассказ о себе
STATUS_SUBMITTED = "submitted"  # анкета отправлена, ждём «Принять» от админа
STATUS_CHOOSING_PLAN = "choosing_plan"  # админ принял, участник выбирает тариф
STATUS_AWAITING_RECEIPT = "awaiting_receipt"  # тариф выбран, ждём чек
STATUS_PAYMENT_REVIEW = "payment_review"  # чек прислан, ждём «Подтвердить» от админа
STATUS_CONFIRMED = "confirmed"  # пользователь платформы создан — сервисный режим


class IntakeApplication(Base):
    """Одна заявка на приём = один Telegram-чат (`tg_id` уникален)."""

    __tablename__ = "intake_applications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
            "'awaiting_receipt', 'payment_review', 'confirmed')",
            name="intake_application_status_valid",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tg_id: Mapped[int] = mapped_column(BigInteger, nullable=False, unique=True)
    tg_username: Mapped[str | None] = mapped_column(Text)
    tg_first_name: Mapped[str | None] = mapped_column(Text)
    tg_last_name: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=STATUS_AWAITING_ABOUT
    )
    about: Mapped[str | None] = mapped_column(Text)
    plan_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("plans.id"))
    # file_id чека (фото или PDF-документ) — Telegram хранит байты, нам нужен только id
    # для пересылки в admin-чат (тот же принцип, что presigned URL для медиа платформы).
    receipt_file_id: Mapped[str | None] = mapped_column(Text)
    receipt_kind: Mapped[str | None] = mapped_column(Text)  # 'photo' | 'document'
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
