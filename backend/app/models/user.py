"""Пользователи платформы."""
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('participant', 'admin')", name="role_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # Логин = TG-аккаунт. Платформа закрытая, регистрации нет — заводит админ.
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(Text, unique=True)  # опционален
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)  # legacy/внешний URL
    # Аватар как media-ассет: presigned-GET подписываем на чтение (avatar_url оставлен
    # под внешний URL — приоритет у media_id).
    avatar_media_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media_assets.id")
    )
    bio: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="participant")
    # Временный (одноразовый) пароль выдан админом — юзер обязан сменить при входе.
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Право создавать группы (по умолчанию у всех; админ может отнять).
    can_create_groups: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    # Настройки кабинета (тема, предпочтения) — без миграций под новые ключи.
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
