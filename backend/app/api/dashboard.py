"""Стартовый экран — один агрегат вместо семи запросов на первом же рендере
после логина (ровно там, где клиентский RUM меряет LCP, см. docs/FRONTEND.md
«Клиентский RUM»). Каждое поле собрано вызовом уже существующей функции своего
раздела — новой бизнес-логики здесь нет, только сборка.
"""
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.calendar import list_events
from app.api.deps import get_current_active_user, require_participant
from app.api.dynamics import (
    frozen_today,
    get_my_day_statuses,
    get_structure,
    intake_window_closed,
)
from app.api.expedition import get_stage_spans, lock_states_for
from app.api.notifications import list_notifications
from app.api.tasks import list_tasks
from app.db.session import get_session
from app.models.message import Message
from app.models.room import Room
from app.models.user import User
from app.schemas.expedition import DashboardOut, ExpeditionOut, NewsPreviewOut, StageSpanOut
from app.schemas.task import TaskWithStatusOut
from app.services.expedition import circle_day_number
from app.services.graduation import is_graduated
from app.services.text_marks import strip_inline_marks

router = APIRouter(
    prefix="/api/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(require_participant)],
)

# Сколько строк показывать в каждой карточке — экран, не полный список раздела.
UPCOMING_EVENTS_LIMIT = 3
ACTIVE_TASKS_LIMIT = 5
NOTIFICATIONS_LIMIT = 5
# Незавершённые статусы (не 'accepted'); common без назначения — my_status is None.
ACTIVE_TASK_STATUSES: tuple[str | None, ...] = (None, "assigned", "returned")


async def _build_expedition(session: AsyncSession, current_user: User) -> ExpeditionOut | None:
    spans = await get_stage_spans(session, current_user.intake_id)
    if not spans:
        return None

    circle_start = spans[0].air_date
    circle_end_day = spans[-1].day_to
    circle_end_date = circle_start + timedelta(days=circle_end_day - 1)

    # «Сегодня» замирает на дне выпуска/закрытия окна — та же граница, что уже
    # применена внутри get_my_day_statuses, иначе маркер «сегодня» на круге и
    # статусы дней разошлись бы у выпускника (см. frozen_today).
    window_closed_on = await intake_window_closed(session, current_user.intake_id)
    today = frozen_today(current_user, window_closed_on)
    days = await get_my_day_statuses(session, current_user, circle_start, circle_end_date)
    locks, states = await lock_states_for(session, current_user, spans)

    return ExpeditionOut(
        total_days=circle_end_day,
        today=circle_day_number(spans, today),
        stages=[
            StageSpanOut(
                kind=s.kind,
                air_date=s.air_date,
                air_time=s.air_time,
                task_id=s.task_id,
                day_from=s.day_from,
                day_to=s.day_to,
            )
            for s in spans
        ],
        days=days,
        locks=locks,
        lock_states=states,
    )


async def _news_preview(session: AsyncSession, current_user: User) -> NewsPreviewOut | None:
    news_room_id = await session.scalar(
        select(Room.id).where(Room.is_news.is_(True), Room.intake_id == current_user.intake_id)
    )
    if news_room_id is None:
        news_room_id = await session.scalar(select(Room.id).where(Room.is_news.is_(True)))
    if news_room_id is None:
        return None

    row = (
        await session.execute(
            select(Message.content, Message.created_at, User.display_name)
            .join(User, User.id == Message.sender_id)
            .where(Message.room_id == news_room_id, Message.deleted_at.is_(None))
            .order_by(Message.id.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    content, created_at, author_name = row
    preview = strip_inline_marks((content or "").strip())
    if len(preview) > 200:
        preview = preview[:200].rstrip() + "…"
    return NewsPreviewOut(
        room_id=news_room_id, author_name=author_name, preview=preview, created_at=created_at
    )


@router.get("", response_model=DashboardOut)
async def get_dashboard(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DashboardOut:
    expedition = await _build_expedition(session, current_user)

    journal = None
    journal_today_done = False
    journal_locked = False
    active_tasks: list[TaskWithStatusOut] = []
    if current_user.role != "admin":
        journal = await get_structure(current_user, session)
        window_closed_on = await intake_window_closed(session, current_user.intake_id)
        if expedition is not None:
            today = frozen_today(current_user, window_closed_on)
            today_status = next(
                (d.status for d in expedition.days if d.date == today), None
            )
            journal_today_done = today_status == "today_closed"
        journal_locked = is_graduated(current_user) or window_closed_on is not None
        task_list = await list_tasks(current_user, session)
        active_tasks = [
            t for t in task_list.items if t.my_status in ACTIVE_TASK_STATUSES
        ][:ACTIVE_TASKS_LIMIT]

    events = await list_events(current_user, session, from_=datetime.now(UTC))
    notifications = await list_notifications(current_user, session, limit=NOTIFICATIONS_LIMIT)
    news = await _news_preview(session, current_user)

    return DashboardOut(
        expedition=expedition,
        journal=journal,
        journal_today_done=journal_today_done,
        journal_locked=journal_locked,
        upcoming_events=events[:UPCOMING_EVENTS_LIMIT],
        active_tasks=active_tasks,
        notifications=notifications.items,
        unread_notifications=notifications.unread_count,
        news_preview=news,
    )
