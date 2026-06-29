"""Доступ к комнатам — единая точка для сообщений, тредов и статусов прочтения.

Авторизация на КАЖДОМ действии (CLAUDE.md п.1, IDOR — угроза №1): «состоит ли юзер
в комнате» зависит от типа. Для dm/group — есть ли строка `room_members`. Для канала
(вариант А, п.3) — он участник платформы; строку членства НЕ плодим, она появляется
лениво только под `last_read_message_id`.
"""
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room, RoomMember
from app.models.user import User


async def load_room(session: AsyncSession, room_id: int) -> Room:
    """Комната существует, иначе 404."""
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    return room


async def assert_room_access(
    session: AsyncSession, room: Room, user: User
) -> RoomMember | None:
    """Проверить доступ юзера к комнате; вернуть строку членства, если она есть.

    dm/group: нет строки членства → 403. channel: доступ у любого участника
    платформы (вариант А) — вернуть существующую строку или None, НЕ создавая её.
    """
    membership = await session.get(RoomMember, (room.id, user.id))
    if room.type == "channel":
        return membership
    if membership is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")
    return membership


async def get_or_create_channel_membership(
    session: AsyncSession, room: Room, user: User
) -> RoomMember:
    """Ленивое членство в канале — только ради хранения last_read_message_id (п.3)."""
    membership = await session.get(RoomMember, (room.id, user.id))
    if membership is None:
        membership = RoomMember(
            room_id=room.id, user_id=user.id, role_in_room="member"
        )
        session.add(membership)
        await session.flush()
    return membership
