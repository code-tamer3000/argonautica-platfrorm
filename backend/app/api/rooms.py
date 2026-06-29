"""Создание комнат, список комнат юзера и управление участниками групп.

Доступ проверяется на сервере на КАЖДОМ действии (CLAUDE.md п.1, IDOR — угроза №1).
Типы: dm (состав фиксирован, дедуп по dm_key), group (членство явное, есть owner),
channel (доступ неявный — вариант А: строк членства на всех не плодим, видны всем).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.room import Room, RoomMember
from app.models.user import User
from app.schemas.room import AddMemberRequest, CreateRoomRequest, MemberOut, RoomOut

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


def _dm_key(a: int, b: int) -> str:
    """Канонический ключ пары для дедупа личных чатов: 'minId:maxId'."""
    lo, hi = sorted((a, b))
    return f"{lo}:{hi}"


async def _create_dm(
    session: AsyncSession, current: User, peer_id: int | None, response: Response
) -> Room:
    if peer_id is None or peer_id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Valid peer_id required for dm")
    if await session.get(User, peer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Peer user not found")

    dm_key = _dm_key(current.id, peer_id)
    existing = (
        await session.execute(select(Room).where(Room.dm_key == dm_key))
    ).scalar_one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK  # дедуп — не плодим
        return existing

    room = Room(type="dm", dm_key=dm_key, created_by=current.id)
    session.add(room)
    try:
        await session.flush()
    except IntegrityError:
        # Гонка: кто-то создал тот же dm параллельно — вернуть существующую.
        await session.rollback()
        existing = (
            await session.execute(select(Room).where(Room.dm_key == dm_key))
        ).scalar_one()
        response.status_code = status.HTTP_200_OK
        return existing

    session.add_all(
        [
            RoomMember(room_id=room.id, user_id=current.id, role_in_room="member"),
            RoomMember(room_id=room.id, user_id=peer_id, role_in_room="member"),
        ]
    )
    await session.flush()
    response.status_code = status.HTTP_201_CREATED
    return room


@router.post("", response_model=RoomOut)
async def create_room(
    body: CreateRoomRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> Room:
    """Создать комнату. Правила доступа зависят от типа (см. модуль)."""
    if body.type == "dm":
        return await _create_dm(session, current_user, body.peer_id, response)

    # group/channel требуют имя.
    if not body.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name is required")

    if body.type == "group":
        if not current_user.can_create_groups:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Not allowed to create groups"
            )
        room = Room(type="group", name=body.name, created_by=current_user.id)
        session.add(room)
        await session.flush()
        # Создатель группы — owner.
        session.add(
            RoomMember(room_id=room.id, user_id=current_user.id, role_in_room="owner")
        )
        await session.flush()
        response.status_code = status.HTTP_201_CREATED
        return room

    # channel — только admin; членских строк не создаём (вариант А).
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    room = Room(type="channel", name=body.name, created_by=current_user.id)
    session.add(room)
    await session.flush()
    response.status_code = status.HTTP_201_CREATED
    return room


@router.get("", response_model=list[RoomOut])
async def list_rooms(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[Room]:
    """Комнаты юзера: его dm/группы (по членству) + все каналы (видны всем, вариант А)."""
    member_rooms = select(RoomMember.room_id).where(
        RoomMember.user_id == current_user.id
    )
    result = await session.execute(
        select(Room)
        .where(or_(Room.type == "channel", Room.id.in_(member_rooms)))
        .order_by(Room.created_at)
    )
    return list(result.scalars().all())


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
