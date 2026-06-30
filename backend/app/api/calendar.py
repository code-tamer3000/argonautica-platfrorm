"""Календарь (SPEC §4.10): общие события проекта или привязанные к комнате/каналу.

Создаёт/правит/удаляет только admin (DATA_MODEL: created_by usually admin). Чтение —
любой участник: project-wide видят все; событие комнаты — только при доступе к ней
(авторизация на КАЖДОМ запросе, CLAUDE.md п.1).
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.calendar import CalendarEvent
from app.models.room import Room, RoomMember
from app.models.user import User
from app.schemas.calendar import (
    CalendarEventCreate,
    CalendarEventOut,
    CalendarEventUpdate,
)
from app.services.rooms import assert_room_access, load_room

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

_PATCHABLE_FIELDS = {"title", "description", "starts_at", "ends_at", "all_day"}


# --- авторские эндпоинты (только admin) ------------------------------------


@router.post("/events", response_model=CalendarEventOut, status_code=201)
async def create_event(
    body: CalendarEventCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CalendarEvent:
    """Создать событие. Если задан room_id — комната должна существовать (404)."""
    if body.room_id is not None:
        await load_room(session, body.room_id)

    event = CalendarEvent(
        title=body.title,
        description=body.description,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        all_day=body.all_day,
        room_id=body.room_id,
        created_by=current_admin.id,
    )
    session.add(event)
    await session.flush()
    await session.refresh(event)
    return event


@router.patch("/events/{event_id}", response_model=CalendarEventOut)
async def update_event(
    event_id: int,
    body: CalendarEventUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CalendarEvent:
    """Частичное обновление whitelisted-полей; согласованность дат проверяем по итогу."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(event, field, value)
    if event.ends_at is not None and event.ends_at < event.starts_at:
        # 422 как у pydantic-валидации создания (константа Starlette переименована).
        raise HTTPException(422, "ends_at must be >= starts_at")
    await session.flush()
    return event


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить событие."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    await session.delete(event)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- чтение (любой активный участник) --------------------------------------


@router.get("/events", response_model=list[CalendarEventOut])
async def list_events(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: Annotated[datetime | None, Query()] = None,
    room_id: Annotated[int | None, Query()] = None,
) -> list[CalendarEvent]:
    """События, видимые юзеру: project-wide + комнаты, к которым есть доступ
    (канал — всем, dm/group — по членству; та же логика, что в списке комнат)."""
    member_rooms = select(RoomMember.room_id).where(
        RoomMember.user_id == current_user.id
    )
    accessible_rooms = select(Room.id).where(
        or_(Room.type == "channel", Room.id.in_(member_rooms))
    )
    stmt = select(CalendarEvent).where(
        or_(
            CalendarEvent.room_id.is_(None),
            CalendarEvent.room_id.in_(accessible_rooms),
        )
    )
    if room_id is not None:
        stmt = stmt.where(CalendarEvent.room_id == room_id)
    if from_ is not None:
        stmt = stmt.where(CalendarEvent.starts_at >= from_)
    if to is not None:
        stmt = stmt.where(CalendarEvent.starts_at <= to)
    stmt = stmt.order_by(CalendarEvent.starts_at)

    return list((await session.execute(stmt)).scalars().all())


@router.get("/events/{event_id}", response_model=CalendarEventOut)
async def get_event(
    event_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CalendarEvent:
    """Одно событие. Project-wide видно всем; событие комнаты — только при доступе."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    if event.room_id is not None:
        room = await load_room(session, event.room_id)
        await assert_room_access(session, room, current_user)
    return event
