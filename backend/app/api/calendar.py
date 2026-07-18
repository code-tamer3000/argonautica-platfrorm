"""Календарь (SPEC §4.10): общие события проекта или привязанные к комнате/каналу.

Создаёт/правит/удаляет только admin (DATA_MODEL: created_by usually admin). Чтение —
любой участник: project-wide видят все; событие комнаты — только при доступе к ней
(авторизация на КАЖДОМ запросе, CLAUDE.md п.1).
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin, require_participant
from app.db.session import get_session
from app.models.calendar import CalendarEvent
from app.models.room import Room, RoomMember
from app.models.task import Task, TaskAssignment
from app.models.user import User
from app.schemas.calendar import (
    CalendarEventCreate,
    CalendarEventOut,
    CalendarEventUpdate,
)
from app.services.rooms import assert_room_access, load_room
from app.services.tasks import participant_count

# Календарь — часть активной работы участника; наблюдателю закрыт.
router = APIRouter(
    prefix="/api/calendar",
    tags=["calendar"],
    dependencies=[Depends(require_participant)],
)

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
) -> list[CalendarEventOut]:
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
    # Дедлайн-события индивидуальных задач адресны: видны только адресату задачи и
    # админу (анти-IDOR, п.1). Общие задачи и обычные события — всем.
    if current_user.role != "admin":
        my_individual_tasks = select(TaskAssignment.task_id).where(
            TaskAssignment.user_id == current_user.id
        )
        visible_task_ids = select(Task.id).where(
            or_(Task.type == "common", Task.id.in_(my_individual_tasks))
        )
        stmt = stmt.where(
            or_(
                CalendarEvent.task_id.is_(None),
                CalendarEvent.task_id.in_(visible_task_ids),
            )
        )
    if room_id is not None:
        stmt = stmt.where(CalendarEvent.room_id == room_id)
    if from_ is not None:
        stmt = stmt.where(CalendarEvent.starts_at >= from_)
    if to is not None:
        stmt = stmt.where(CalendarEvent.starts_at <= to)
    stmt = stmt.order_by(CalendarEvent.starts_at)

    events = list((await session.execute(stmt)).scalars().all())
    return await _enrich_task_events(session, events, current_user)


async def _enrich_task_events(
    session: AsyncSession,
    events: list[CalendarEvent],
    user: User,
) -> list[CalendarEventOut]:
    """Обогатить дедлайн-события состоянием задачи (одним батч-запросом).

    Для участника проставляем `task_done` (его назначение принято) — чтобы
    выполненный дедлайн в календаре читался так же, как в разделе «Задачи».
    Для админа добавляем прогресс проверки `submitted / total` по задаче; чужой
    прогресс участнику не раскрываем (анти-IDOR, п.1).
    """
    is_admin = user.role == "admin"
    task_ids = [e.task_id for e in events if e.task_id is not None]

    my_accepted: set[int] = set()
    admin_progress: dict[int, tuple[int, int]] = {}
    if task_ids:
        if not is_admin:
            rows = await session.execute(
                select(TaskAssignment.task_id).where(
                    TaskAssignment.task_id.in_(task_ids),
                    TaskAssignment.user_id == user.id,
                    TaskAssignment.status == "accepted",
                )
            )
            my_accepted = set(rows.scalars().all())
        else:
            # Сдали (у кого назначение сдано/возвращено/принято) по каждой задаче.
            agg = await session.execute(
                select(
                    TaskAssignment.task_id,
                    func.count().filter(
                        TaskAssignment.status.in_(
                            ("submitted", "returned", "accepted")
                        )
                    ),
                    func.count(),
                )
                .where(TaskAssignment.task_id.in_(task_ids))
                .group_by(TaskAssignment.task_id)
            )
            submitted_by_task: dict[int, int] = {}
            assigned_by_task: dict[int, int] = {}
            for tid, submitted, total in agg.all():
                submitted_by_task[tid] = submitted
                assigned_by_task[tid] = total
            # Знаменатель: individual → число адресатов; common → участники (лениво).
            type_rows = await session.execute(
                select(Task.id, Task.type).where(Task.id.in_(task_ids))
            )
            participants: int | None = None
            for tid, ttype in type_rows.all():
                if ttype == "common":
                    if participants is None:
                        participants = await participant_count(session)
                    total = participants
                else:
                    total = assigned_by_task.get(tid, 0)
                admin_progress[tid] = (submitted_by_task.get(tid, 0), total)

    out: list[CalendarEventOut] = []
    for e in events:
        item = CalendarEventOut.model_validate(e)
        if e.task_id is not None:
            if is_admin:
                submitted, total = admin_progress.get(e.task_id, (0, 0))
                item.task_submitted_count = submitted
                item.task_total_count = total
            else:
                item.task_done = e.task_id in my_accepted
        out.append(item)
    return out


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
    if event.task_id is not None:
        # Видимость дедлайн-события = видимость задачи (individual — только адресат/админ).
        from app.services.tasks import assert_task_visible, load_task

        task = await load_task(session, event.task_id)
        await assert_task_visible(session, task, current_user)
    return event
