"""Календарь (SPEC §4.10): общие события проекта, изолированные по потоку/тарифу.

Создаёт/правит/удаляет только admin. Чтение — любой активный участник: двойной
фильтр поток+тариф (ARG-96/ARG-111), тот же принцип, что у каналов/common-задач/
материалов КБ (services/visibility.py). Авторизация на КАЖДОМ запросе (CLAUDE.md п.1).
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin, require_participant
from app.db.session import get_session
from app.models.calendar import CalendarEvent, CalendarEventPlan
from app.models.intake import Intake
from app.models.plan import Plan
from app.models.task import Task, TaskAssignment, TaskPlan
from app.models.user import User
from app.schemas.calendar import (
    CalendarEventCreate,
    CalendarEventOut,
    CalendarEventUpdate,
)
from app.services.tasks import participant_count
from app.services.visibility import intake_visible, plan_visibility_clause, plan_visible

# Календарь — часть активной работы участника; наблюдателю закрыт.
router = APIRouter(
    prefix="/api/calendar",
    tags=["calendar"],
    dependencies=[Depends(require_participant)],
)

_PATCHABLE_FIELDS = {"title", "description", "starts_at", "ends_at", "all_day", "intake_id"}


async def _assert_intake_exists(session: AsyncSession, intake_id: int | None) -> None:
    if intake_id is None:
        return
    if await session.get(Intake, intake_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intake not found")


async def _assert_plans_exist(session: AsyncSession, plan_ids: list[int]) -> None:
    if not plan_ids:
        return
    found = await session.execute(select(Plan.id).where(Plan.id.in_(plan_ids)))
    if set(found.scalars().all()) != set(plan_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")


async def _set_event_plans(session: AsyncSession, event_id: int, plan_ids: list[int]) -> None:
    """Полностью заменить набор тарифов события."""
    await session.execute(
        sa_delete(CalendarEventPlan).where(CalendarEventPlan.calendar_event_id == event_id)
    )
    for plan_id in dict.fromkeys(plan_ids):
        session.add(CalendarEventPlan(calendar_event_id=event_id, plan_id=plan_id))


async def _event_plan_ids(session: AsyncSession, event_id: int) -> list[int]:
    rows = await session.execute(
        select(CalendarEventPlan.plan_id)
        .where(CalendarEventPlan.calendar_event_id == event_id)
        .order_by(CalendarEventPlan.plan_id)
    )
    return list(rows.scalars().all())


async def _events_plan_ids(
    session: AsyncSession, event_ids: list[int]
) -> dict[int, list[int]]:
    """calendar_event_id -> [plan_id, ...] одним запросом (без N+1)."""
    if not event_ids:
        return {}
    rows = await session.execute(
        select(CalendarEventPlan.calendar_event_id, CalendarEventPlan.plan_id)
        .where(CalendarEventPlan.calendar_event_id.in_(event_ids))
        .order_by(CalendarEventPlan.plan_id)
    )
    result: dict[int, list[int]] = {}
    for event_id, plan_id in rows.all():
        result.setdefault(event_id, []).append(plan_id)
    return result


async def assert_calendar_event_visible(
    session: AsyncSession, event: CalendarEvent, user: User
) -> None:
    """Двойной фильтр поток+тариф (ARG-96/ARG-111) на самом событии.

    Admin видит всё. У событий нет черновиков — событие чужого потока/тарифа для
    участника просто недоступно (403), тем же принципом, что common-задачи/каналы
    (не 404, как у KB item — календарю нечего прятать как «несуществующее»).
    """
    if user.role == "admin":
        return
    if not intake_visible(event.intake_id, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this event")
    if not await plan_visible(
        session,
        CalendarEventPlan.plan_id,
        CalendarEventPlan.calendar_event_id,
        event.id,
        user.plan_id,
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this event")


# --- авторские эндпоинты (только admin) ------------------------------------


@router.post("/events", response_model=CalendarEventOut, status_code=201)
async def create_event(
    body: CalendarEventCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CalendarEventOut:
    """Создать событие."""
    await _assert_intake_exists(session, body.intake_id)
    await _assert_plans_exist(session, body.plan_ids)

    event = CalendarEvent(
        title=body.title,
        description=body.description,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        all_day=body.all_day,
        intake_id=body.intake_id,
        created_by=current_admin.id,
    )
    session.add(event)
    await session.flush()
    await _set_event_plans(session, event.id, body.plan_ids)
    await session.flush()
    await session.refresh(event)

    out = CalendarEventOut.model_validate(event)
    out.plan_ids = body.plan_ids
    return out


@router.patch("/events/{event_id}", response_model=CalendarEventOut)
async def update_event(
    event_id: int,
    body: CalendarEventUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CalendarEventOut:
    """Частичное обновление whitelisted-полей; согласованность дат проверяем по итогу."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")

    changes = body.model_dump(exclude_unset=True)
    if "intake_id" in changes:
        await _assert_intake_exists(session, changes["intake_id"])
    if "plan_ids" in changes and changes["plan_ids"] is not None:
        await _assert_plans_exist(session, changes["plan_ids"])
        await _set_event_plans(session, event.id, changes["plan_ids"])
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(event, field, value)
    if event.ends_at is not None and event.ends_at < event.starts_at:
        # 422 как у pydantic-валидации создания (константа Starlette переименована).
        raise HTTPException(422, "ends_at must be >= starts_at")
    await session.flush()

    out = CalendarEventOut.model_validate(event)
    out.plan_ids = await _event_plan_ids(session, event.id)
    return out


@router.delete("/events/{event_id}", status_code=204)
async def delete_event(
    event_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить событие (и его связи с тарифами — FK)."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    await session.execute(
        sa_delete(CalendarEventPlan).where(CalendarEventPlan.calendar_event_id == event_id)
    )
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
) -> list[CalendarEventOut]:
    """События, видимые юзеру: двойной фильтр поток+тариф (ARG-96/ARG-111); admin — все."""
    stmt = select(CalendarEvent)
    if current_user.role != "admin":
        stmt = stmt.where(
            or_(
                CalendarEvent.intake_id.is_(None),
                CalendarEvent.intake_id == current_user.intake_id,
            ),
            plan_visibility_clause(
                CalendarEventPlan.plan_id,
                CalendarEventPlan.calendar_event_id,
                CalendarEvent.id,
                current_user.plan_id,
            ),
        )
        # Дедлайн-события индивидуальных задач адресны: видны только адресату задачи и
        # админу (анти-IDOR, п.1). Общие задачи и обычные события — всем.
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
    """Обогатить дедлайн-события состоянием задачи (одним батч-запросом) + тарифы.

    Для участника проставляем `task_done` (его назначение принято) — чтобы
    выполненный дедлайн в календаре читался так же, как в разделе «Задачи».
    Для админа добавляем прогресс проверки `submitted / total` по задаче; чужой
    прогресс участнику не раскрываем (анти-IDOR, п.1).
    """
    is_admin = user.role == "admin"
    task_ids = [e.task_id for e in events if e.task_id is not None]
    plan_ids_by_event = await _events_plan_ids(session, [e.id for e in events])

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
            # Знаменатель: individual/pair/stream → число адресатов; common →
            # участники, кому она видна (поток+тариф ARG-96, без наблюдателей).
            task_rows = list(
                (
                    await session.execute(select(Task).where(Task.id.in_(task_ids)))
                )
                .scalars()
                .all()
            )
            task_plans: dict[int, list[int]] = {}
            plan_rows = await session.execute(
                select(TaskPlan.task_id, TaskPlan.plan_id).where(
                    TaskPlan.task_id.in_(task_ids)
                )
            )
            for tid, pid in plan_rows.all():
                task_plans.setdefault(tid, []).append(pid)
            for t in task_rows:
                if t.type == "common":
                    total = await participant_count(
                        session, t, plan_ids=task_plans.get(t.id, [])
                    )
                else:
                    total = assigned_by_task.get(t.id, 0)
                admin_progress[t.id] = (submitted_by_task.get(t.id, 0), total)

    out: list[CalendarEventOut] = []
    for e in events:
        item = CalendarEventOut.model_validate(e)
        item.plan_ids = plan_ids_by_event.get(e.id, [])
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
) -> CalendarEventOut:
    """Одно событие. Двойной фильтр поток+тариф + видимость связанной задачи."""
    event = await session.get(CalendarEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    await assert_calendar_event_visible(session, event, current_user)
    if event.task_id is not None:
        # Видимость дедлайн-события = видимость задачи (individual — только адресат/админ).
        from app.services.tasks import assert_task_visible, load_task

        task = await load_task(session, event.task_id)
        await assert_task_visible(session, task, current_user)

    out = CalendarEventOut.model_validate(event)
    out.plan_ids = await _event_plan_ids(session, event.id)
    return out
