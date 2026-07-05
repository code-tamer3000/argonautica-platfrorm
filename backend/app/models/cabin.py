"""Раздел «Каюта» — личная психологическая проработка участника.

Три подраздела (kind): дневник эмоций, протокол декатастрофизации, триггеры
(построение гипотезы). У всех — одна форма-«плашка», набор полей отличается, поэтому
конкретные поля лежат в JSONB `data`, а не в отдельных колонках на каждый подраздел
(добавить/поменять поле формы — без миграции; три таблицы-близнеца не нужны).

Приватность (решение по задаче): запись видит её автор; админ может просматривать
записи участников (как в «Динамике»/«Поддержке»). Правки/удаление — только автор.
Поэтому в БД это доменные данные (Postgres), а не эфемерка (п.5 CLAUDE.md).
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CabinEntry(Base):
    """Одна «плашка» в разделе «Каюта».

    kind — подраздел (diary/decatastrophize/trigger). data — поля формы этого
    подраздела (см. схемы в app.schemas.cabin, там же валидируется структура).
    """

    __tablename__ = "cabin_entries"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('diary', 'decatastrophize', 'trigger')",
            name="cabin_entries_kind_valid",
        ),
        # Лента подраздела для владельца: его записи одного kind, сначала новые.
        Index("ix_cabin_entries_user_kind_created", "user_id", "kind", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
