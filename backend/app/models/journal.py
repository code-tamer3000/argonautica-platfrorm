"""Журнал-прогресс: помилования (пропуск дня аннулируется)."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class JournalPardon(Base):
    """Одно помилование = один прощённый пропущенный день у пользователя."""

    __tablename__ = "journal_pardons"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_journal_pardons_user_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
