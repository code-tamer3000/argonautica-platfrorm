"""Набор: когорта участников с общей датой старта 28-дневного окна Динамики."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Intake(Base):
    """Набор участников. Дата старта задаёт точку отсчёта окна Динамики для всех,
    кто к набору привязан (`users.intake_id`) — не структуру дневника, только окно.
    """

    __tablename__ = "intakes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
