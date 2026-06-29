"""Управление участниками групп (type='group').

Членство и роль в комнате проверяются на сервере на КАЖДОМ действии (CLAUDE.md п.1,
IDOR — угроза №1). Только для групп: в dm состав фиксирован, у каналов доступ неявный
(вариант А — строки членства лениво, ими так не управляют).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.room import Room, RoomMember
from app.models.user import User
from app.schemas.room import AddMemberRequest, MemberOut

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


async def _load_group(session: AsyncSession, room_id: int) -> Room:
    """Комната существует и это группа, иначе 404/400 (так же режем канал/dm)."""
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    if room.type != "group":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Member management is only available for groups",
        )
    return room


async def _is_room_owner(session: AsyncSession, room_id: int, user_id: int) -> bool:
    membership = await session.get(RoomMember, (room_id, user_id))
    return membership is not None and membership.role_in_room == "owner"


async def _count_owners(session: AsyncSession, room_id: int) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(RoomMember)
        .where(RoomMember.room_id == room_id, RoomMember.role_in_room == "owner")
    )
    return result.scalar_one()


@router.post("/{room_id}/members", response_model=MemberOut)
async def add_member(
    room_id: int,
    body: AddMemberRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> RoomMember:
    """Добавить участника. Можно owner группы или platform-admin. Идемпотентно."""
    await _load_group(session, room_id)

    is_admin = current_user.role == "admin"
    if not is_admin and not await _is_room_owner(session, room_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner or admin required")

    target = await session.get(User, body.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    existing = await session.get(RoomMember, (room_id, body.user_id))
    if existing is not None:
        response.status_code = status.HTTP_200_OK  # уже участник — не дублим
        return existing

    membership = RoomMember(
        room_id=room_id, user_id=body.user_id, role_in_room="member"
    )
    session.add(membership)
    await session.flush()
    await session.refresh(membership)
    response.status_code = status.HTTP_201_CREATED
    return membership


@router.delete("/{room_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    room_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить участника (owner/admin) или выйти самому (любой участник)."""
    await _load_group(session, room_id)

    is_self = user_id == current_user.id
    if not is_self:
        is_admin = current_user.role == "admin"
        if not is_admin and not await _is_room_owner(session, room_id, current_user.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner or admin required")

    membership = await session.get(RoomMember, (room_id, user_id))
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User is not a member")

    # Нельзя удалить единственного owner'а — иначе группа осиротеет.
    # Передача владения — отдельной фичей позже.
    if (
        membership.role_in_room == "owner"
        and await _count_owners(session, room_id) == 1
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot remove the sole owner; transfer ownership first",
        )

    await session.delete(membership)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
