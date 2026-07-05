"""Метаданные файлов. Байты — в MinIO; здесь только метаданные и ссылка на объект."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MediaAsset(Base):
    """Централизованное хранилище метаданных. Публичный URL НЕ хранится (presigned)."""

    __tablename__ = "media_assets"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('image', 'video', 'file', 'audio')", name="kind_valid"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    bucket: Mapped[str] = mapped_column(Text, nullable=False)
    storage_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Ключ уменьшенного превью в том же бакете (для картинок; None — превью нет:
    # старые записи, видео/файлы, либо не сгенерировалось). В ленте отдаём превью,
    # оригинал — только по клику/скачиванию. Генерится best-effort при подтверждении.
    thumb_key: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)  # байты
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration: Mapped[int | None] = mapped_column(Integer)  # секунды, для видео
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
