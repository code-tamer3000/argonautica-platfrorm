"""Комнаты (dm/group/channel) и членство в них."""
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Room(Base):
    """Одна сущность на три типа пространств; различия типов — поведение в коде."""

    __tablename__ = "rooms"
    __table_args__ = (
        CheckConstraint("type IN ('dm', 'group', 'channel')", name="type_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str | None] = mapped_column(Text)  # NULL для dm
    avatar_url: Mapped[str | None] = mapped_column(Text)  # legacy/внешний URL, для dm не хранится
    # Аватар как media-ассет (пока только для личного дневника — see docs/ROOMS.md):
    # presigned-GET подписываем на чтение, avatar_url оставлен под внешний URL —
    # приоритет у media_id. Та же пара полей, что и у User.avatar_url/avatar_media_id.
    avatar_media_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media_assets.id")
    )
    # Только для dm: канонический ключ пары "minUserId:maxUserId" — защита от дублей.
    dm_key: Mapped[str | None] = mapped_column(Text, unique=True)
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    is_personal: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Новостной канал платформы (singleton). Верхнеуровневые посты — только admin.
    is_news: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Изоляция по потоку (ARG-96): только для type='channel' (неявная видимость —
    # «участник платформы видит все каналы»). NULL = общий для всех потоков.
    # dm/group гейтятся явным членством и это поле игнорируют; новостной канал
    # (is_news) НЕ бэкфиллится — остаётся кросс-поточным намеренно.
    intake_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("intakes.id")
    )
    # Одностороннее ограничение записи в dm с НЕ-навигатор-админом (ARG-110, часть B,
    # см. services/rooms.py `dm_write_allowed`) снимается навсегда, как только этот
    # админ сам пишет в dm первым — независимо от ранга тарифа собеседника. Только
    # для type='dm'; для остальных типов комнат поле не используется.
    dm_unlocked_by_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Только для type='group': композер закрыт всем, кроме admin (ARG-142).
    # Переключается только platform admin. Реакции и правки старых сообщений
    # это поле не гейтит — см. docs/ROOMS.md.
    is_readonly: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )


class RoomPlan(Base):
    """Канал доступен только перечисленным тарифам; пусто = всем тарифам потока."""

    __tablename__ = "room_plans"

    room_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("rooms.id"), primary_key=True
    )
    plan_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("plans.id"), primary_key=True
    )


class RoomMember(Base):
    """Членство + состояние чтения. Для каналов строки создаются лениво (вариант А)."""

    __tablename__ = "room_members"
    __table_args__ = (
        CheckConstraint(
            "role_in_room IN ('owner', 'member')", name="role_in_room_valid"
        ),
    )

    room_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("rooms.id"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id"), primary_key=True
    )
    role_in_room: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="member"
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # До какого сообщения дочитал — на этом держатся статусы прочтения.
    last_read_message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("messages.id")
    )
    is_muted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
