"""Стикерпаки и стикеры. Паки добавляет только admin."""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Stickerpack(Base):
    __tablename__ = "stickerpacks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Sticker(Base):
    __tablename__ = "stickers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pack_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("stickerpacks.id"), nullable=False
    )
    image_url: Mapped[str | None] = mapped_column(Text)  # legacy/внешний URL
    # Картинка стикера как media-ассет (presigned-GET на чтение); приоритет у media_id.
    image_media_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media_assets.id")
    )
    keyword: Mapped[str | None] = mapped_column(Text)  # для поиска/подстановки
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
