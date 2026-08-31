"""События календаря (общие или привязанные к дедлайну задачи)."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    all_day: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Автоуправляемая привязка к дедлайну задачи (сервис синхронизирует событие с
    # tasks.deadline_at). NULL = обычное событие, не связанное с задачей.
    task_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tasks.id"))
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Изоляция по потоку (ARG-96/ARG-111): NULL = событие общее для всех потоков.
    intake_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("intakes.id")
    )


class CalendarEventPlan(Base):
    """Событие доступно только перечисленным тарифам; пусто = всем тарифам потока."""

    __tablename__ = "calendar_event_plans"

    calendar_event_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("calendar_events.id"), primary_key=True
    )
    plan_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("plans.id"), primary_key=True
    )
