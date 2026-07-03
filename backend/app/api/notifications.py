"""Лента уведомлений и отметка прочитанными (колокольчик в шапке).

Уведомления всегда принадлежат текущему юзеру (`user_id`) — читаем/меняем только
свои строки (п.1: не доверяем id от клиента).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.message import Message
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    MarkReadRequest,
    NotificationListOut,
    NotificationOut,
)
from app.services.notifications import (
    _preview,
    ensure_journal_notifications,
    journal_missed_preview,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


async def _unread_count(session: AsyncSession, user_id: int) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        )
    ).scalar_one()


@router.get("", response_model=NotificationListOut)
async def list_notifications(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    before: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> NotificationListOut:
    """Последние уведомления юзера (курсор по id) + счётчик непрочитанных.

    По ходу лениво досоздаём системные уведомления о незакрытых днях дневника
    (планировщика нет — генерируем при обращении к ленте).
    """
    await ensure_journal_notifications(session, current_user)

    # outer join: у системных уведомлений (journal_missed) actor_id/message_id пусты.
    stmt = (
        select(Notification, User.display_name, Message.content)
        .outerjoin(User, User.id == Notification.actor_id)
        .outerjoin(Message, Message.id == Notification.message_id)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(Notification.id < before)

    rows = (await session.execute(stmt)).all()
    items = [
        NotificationOut(
            id=n.id,
            kind=n.kind,
            room_id=n.room_id,
            message_id=n.message_id,
            actor_id=n.actor_id,
            actor_name=actor_name,
            preview=(
                journal_missed_preview(n.ref_date)
                if n.kind == "journal_missed"
                else _preview(content)
            ),
            ref_date=n.ref_date,
            created_at=n.created_at,
            read_at=n.read_at,
        )
        for n, actor_name, content in rows
    ]
    return NotificationListOut(
        items=items, unread_count=await _unread_count(session, current_user.id)
    )


@router.post("/read", response_model=NotificationListOut)
async def mark_read(
    body: MarkReadRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> NotificationListOut:
    """Отметить прочитанными: все (up_to_id=None) или с id <= up_to_id. Идемпотентно."""
    stmt = (
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    if body.up_to_id is not None:
        stmt = stmt.where(Notification.id <= body.up_to_id)
    await session.execute(stmt)
    await session.flush()
    return NotificationListOut(
        items=[], unread_count=await _unread_count(session, current_user.id)
    )
