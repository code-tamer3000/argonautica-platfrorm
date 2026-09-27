"""Клуб «Факел» (ARG-54): общая заглушка для тех, кому `users.torch_unlocked` ещё false.

Один общий текст на всех закрытых, не персонализированный (см. Assumptions в ARG-54) —
поэтому одна строка-singleton, а не таблица на пользователя. Комната клуба сама по себе
не нуждается в отдельной модели: она обычная `rooms` с `is_torch=True`
(см. app/models/room.py, app/services/torch.py).
"""
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

DEFAULT_TORCH_STUB_TEXT = (
    "Факел зажигается не сразу — доступ в клуб выпускников открывает администратор."
)


class TorchSettings(Base):
    """Единственная строка (id=1) — общий текст заглушки, правит админ."""

    __tablename__ = "torch_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    stub_text: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=DEFAULT_TORCH_STUB_TEXT
    )
    # Администратор, с которым сводит кнопка «Подать заявку» на гейте (ARG-158).
    # Один на платформу, nullable — пока не назначен, кнопка на гейте не
    # показывается вовсе (см. app/api/torch.py).
    admin_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
