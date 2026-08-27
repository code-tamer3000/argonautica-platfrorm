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
    Index,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Шаги воронки. Переходы строго по порядку, кроме «Задать вопрос» — она не меняет status.
STATUS_AWAITING_ABOUT = "awaiting_about"  # /start отправлен, ждём рассказ о себе
STATUS_SUBMITTED = "submitted"  # анкета отправлена, ждём «Принять» от админа
STATUS_CHOOSING_PLAN = "choosing_plan"  # админ принял, участник выбирает тариф
STATUS_AWAITING_OFFER = "awaiting_offer"  # тариф выбран, ждём согласие с офертой (ARG-43)
STATUS_AWAITING_RECEIPT = "awaiting_receipt"  # оферта принята, ждём чек
STATUS_PAYMENT_REVIEW = "payment_review"  # чек прислан, ждём «Подтвердить» от админа
STATUS_CONFIRMED = "confirmed"  # пользователь платформы создан — сервисный режим
STATUS_EXPIRED = "expired"  # бронь не оплачена за отведённое окно — заявка аннулирована

# Шаги, на которых тикают часы брони (ARG-108). `payment_review` в список НЕ входит
# намеренно: чек уже прислан, дальше ход админа — заявка не должна сгореть, пока он
# не нажал «Подтвердить оплату».
STATUSES_ON_PAYMENT_CLOCK = (
    STATUS_CHOOSING_PLAN,
    STATUS_AWAITING_OFFER,
    STATUS_AWAITING_RECEIPT,
)


class IntakeApplication(Base):
    """Одна заявка на приём = один Telegram-чат (`tg_id` уникален)."""

    __tablename__ = "intake_applications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('awaiting_about', 'submitted', 'choosing_plan', "
            "'awaiting_offer', 'awaiting_receipt', 'payment_review', 'confirmed', "
            "'expired')",
            name="intake_application_status_valid",
        ),
        # ARG-107: CRM-дашборд группирует заявки по статусу и сортирует по свежести.
        Index("ix_intake_applications_status", "status"),
        Index("ix_intake_applications_created_at", "created_at"),
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
    # Момент входа в каждую стадию (ARG-107, CRM-дашборд воронки) — nullable, проставляется
    # в intake_bot.py рядом с присвоением `status`. Историческим строкам может не хватать
    # ранних стадий (backfill только приближает submitted_at, confirmed_at — точный).
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan_chosen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    receipt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("plans.id"))
    # file_id чека (фото или PDF-документ) — Telegram хранит байты, нам нужен только id
    # для пересылки в admin-чат (тот же принцип, что presigned URL для медиа платформы).
    receipt_file_id: Mapped[str | None] = mapped_column(Text)
    receipt_kind: Mapped[str | None] = mapped_column(Text)  # 'photo' | 'document'
    # Согласие с офертой (ARG-43) — проставляется в обработчике callback'а «Согласен,
    # к оплате», ДО того как участнику открывается шаг присылки чека.
    offer_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    offer_version: Mapped[str | None] = mapped_column(Text)  # редакция принятой оферты
    # Бронь места (ARG-108): дедлайн ставится в момент «Принять» и тикает только в
    # STATUSES_ON_PAYMENT_CLOCK. `expired_at` — когда бронь фактически сняли.
    payment_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
