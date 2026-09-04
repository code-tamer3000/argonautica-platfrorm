"""Лента уведомлений и отметка прочитанными (колокольчик в шапке).

Уведомления всегда принадлежат текущему юзеру (`user_id`) — читаем/меняем только
свои строки (п.1: не доверяем id от клиента).
"""
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_participant
from app.db.session import get_session
from app.models.message import Message
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    MarkReadRequest,
    NotificationListOut,
    NotificationOut,
)
from app.services.notifications import _preview
from app.services.redaction import redact_zoom_links
from app.services.visibility import is_cheap_tariff

# Наблюдателю уведомления не адресуются (нет чата/задач/ответов) — весь роутер закрыт.
router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
    dependencies=[Depends(require_participant)],
)

# Сколько держим прочитанное в ленте после прочтения, прежде чем убрать из выдачи
# (не из БД — строка остаётся, просто перестаёт попадать в этот запрос).
READ_FEED_RETENTION = timedelta(hours=48)


def _redacted_preview(kind: str, body: str | None, viewer_is_cheap_tariff: bool) -> str | None:
    """ARG-116: та же Zoom-маскировка, что и в самой Рубке (ARG-115) — только для
    уведомлений о новости (`kind == "news"`), только для дешёвого тарифа."""
    preview = _preview(body)
    if preview is not None and kind == "news" and viewer_is_cheap_tariff:
        preview = redact_zoom_links(preview)
    return preview


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
    """Непрочитанные + прочитанные не старше READ_FEED_RETENTION (курсор по id)
    + счётчик непрочитанных. Старое прочитанное не удаляется — просто не попадает
    в эту выдачу (см. docs/NOTIFICATIONS.md)."""
    read_cutoff = datetime.now(UTC) - READ_FEED_RETENTION
    # outer join: у системных уведомлений (cabin_granted/admin) actor_id/message_id пусты.
    stmt = (
        select(Notification, User.display_name, Message.content)
        .outerjoin(User, User.id == Notification.actor_id)
        .outerjoin(Message, Message.id == Notification.message_id)
        .where(
            Notification.user_id == current_user.id,
            or_(Notification.read_at.is_(None), Notification.read_at >= read_cutoff),
        )
        .order_by(Notification.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(Notification.id < before)

    rows = (await session.execute(stmt)).all()
    # ARG-116: Zoom-ссылка в тексте новости скрыта в самой Рубке (ARG-115) — та же
    # маскировка нужна и здесь, иначе колокольчик её всё равно покажет.
    cheap_tariff = await is_cheap_tariff(session, current_user)
    items = [
        NotificationOut(
            id=n.id,
            kind=n.kind,
            room_id=n.room_id,
            message_id=n.message_id,
            actor_id=n.actor_id,
            actor_name=actor_name,
            preview=_redacted_preview(
                n.kind, n.body if n.kind == "admin" else content, cheap_tariff
            ),
            ref_date=n.ref_date,
            title=n.title,
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
