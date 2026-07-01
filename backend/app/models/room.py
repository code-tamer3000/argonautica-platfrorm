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
    avatar_url: Mapped[str | None] = mapped_column(Text)  # для dm не хранится
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
