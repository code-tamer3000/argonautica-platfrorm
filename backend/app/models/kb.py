"""База знаний: категории (на вырост), материалы и их медиа."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class KbCategory(Base):
    """Группировка разделов — структура заложена, но вне MVP."""

    __tablename__ = "kb_categories"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


class KbItem(Base):
    """Материалы автора."""

    __tablename__ = "kb_items"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # NULL = плоский список (MVP).
    category_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("kb_categories.id")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str | None] = mapped_column(Text)  # markdown
    published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class KbItemMedia(Base):
    """Связь материала с файлами/видео (через общую media_assets)."""

    __tablename__ = "kb_item_media"

    kb_item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("kb_items.id"), primary_key=True
    )
    media_asset_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("media_assets.id"), primary_key=True
    )


class KbComment(Base):
    """Плоские комментарии участников под материалом. Мягкое удаление (п.6)."""

    __tablename__ = "kb_comments"
    __table_args__ = (
        # Лента комментариев материала — запрос по этому индексу.
        Index("ix_kb_comments_item_created", "kb_item_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kb_item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("kb_items.id"), nullable=False
    )
    author_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
