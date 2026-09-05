"""Архивный доступ к потоку — история «был участником», отдельно от активного
`users.intake_id`.

Одна строка = «этот пользователь был участником этого потока»: ему на чтение
доступны дневники и материалы КБ того потока, а его собственный дневник виден
участникам того потока (см. `app/services/visibility.py`). Активный поток строкой
здесь не дублируется — снятие архивного доступа не может задеть текущий поток.
Назначается вручную админом (`PATCH /api/admin/users/{id}`), без автоматики при
переводе между потоками.
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserIntakeAccess(Base):
    __tablename__ = "user_intake_access"
    __table_args__ = (
        Index("ix_user_intake_access_intake", "intake_id"),
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    intake_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("intakes.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
