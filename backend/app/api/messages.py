"""Сообщения, треды, мягкое удаление и статусы прочтения.

Доступ проверяется на сервере на КАЖДОМ действии (CLAUDE.md п.1) через
`app.services.rooms`. Треды плоские (п.2): ответ всегда привязан к КОРНЮ, не к
другому ответу. Удаление мягкое (п.6). Прочтения — через `last_read_message_id`
без отдельной таблицы (п.4).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment
from app.models.sticker import Sticker
from app.models.user import User
from app.schemas.message import (
    MessageOut,
    ReadRequest,
    ReadStateOut,
    SendMessageRequest,
    ThreadOut,
)
from app.services.rooms import (
    assert_room_access,
    get_or_create_channel_membership,
    load_room,
)

router = APIRouter(prefix="/api/rooms", tags=["messages"])


async def _attachments_map(
    session: AsyncSession, message_ids: list[int]
) -> dict[int, list[int]]:
    """message_id -> [media_asset_id, ...] одним запросом (без N+1)."""
    if not message_ids:
        return {}
    rows = await session.execute(
        select(MessageAttachment.message_id, MessageAttachment.media_asset_id)
        .where(MessageAttachment.message_id.in_(message_ids))
        .order_by(MessageAttachment.media_asset_id)
    )
    result: dict[int, list[int]] = {}
    for message_id, media_asset_id in rows.all():
        result.setdefault(message_id, []).append(media_asset_id)
    return result


def _to_out(message: Message, attachment_ids: list[int]) -> MessageOut:
    out = MessageOut.model_validate(message)
    out.attachment_ids = attachment_ids
    return out


@router.post("/{room_id}/messages", response_model=MessageOut, status_code=201)
async def send_message(
    room_id: int,
    body: SendMessageRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageOut:
    """Отправить сообщение (текст / стикер / вложения), опционально — ответ в тред."""
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    if body.sticker_id is not None and await session.get(Sticker, body.sticker_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found")

    if body.attachment_ids:
        found = await session.execute(
            select(MediaAsset.id).where(MediaAsset.id.in_(body.attachment_ids))
        )
        if set(found.scalars().all()) != set(body.attachment_ids):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")

    # Плоскость тредов (п.2): привязка всегда к КОРНЮ. Отвечают на ответ —
    # берём его thread_root_id, не его id.
    thread_root_id: int | None = None
    if body.reply_to_message_id is not None:
        target = await session.get(Message, body.reply_to_message_id)
        if (
            target is None
            or target.room_id != room_id
            or target.deleted_at is not None
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Reply target not found")
        thread_root_id = target.thread_root_id or target.id

    message = Message(
        room_id=room_id,
        sender_id=current_user.id,
        content=body.content,
        sticker_id=body.sticker_id,
        thread_root_id=thread_root_id,
    )
    session.add(message)
    await session.flush()

    for media_asset_id in body.attachment_ids:
        session.add(
            MessageAttachment(message_id=message.id, media_asset_id=media_asset_id)
        )

    # Денормализация на корне — «N ответов» без пересчёта.
    if thread_root_id is not None:
        await session.execute(
            update(Message)
            .where(Message.id == thread_root_id)
            .values(reply_count=Message.reply_count + 1, last_reply_at=func.now())
        )

    await session.flush()
    await session.refresh(message)
    return _to_out(message, list(body.attachment_ids))


@router.get("/{room_id}/messages", response_model=list[MessageOut])
async def list_messages(
    room_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    before: Annotated[int | None, Query()] = None,
    after: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[MessageOut]:
    """Лента комнаты: верхний уровень, без удалённых. Курсор по id (before/after)."""
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    stmt = (
        select(Message)
        .where(
            Message.room_id == room_id,
            Message.thread_root_id.is_(None),
            Message.deleted_at.is_(None),
        )
        .order_by(Message.id.desc())
        .limit(limit)
    )
    if before is not None:
        stmt = stmt.where(Message.id < before)
    if after is not None:
        stmt = stmt.where(Message.id > after)

    messages = list((await session.execute(stmt)).scalars().all())
    attachments = await _attachments_map(session, [m.id for m in messages])
    return [_to_out(m, attachments.get(m.id, [])) for m in messages]


@router.get("/{room_id}/messages/{root_id}/thread", response_model=ThreadOut)
async def get_thread(
    room_id: int,
    root_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ThreadOut:
    """Открытый тред: корень + его ответы (удалённые не попадают)."""
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    root = await session.get(Message, root_id)
    if (
        root is None
        or root.room_id != room_id
        or root.thread_root_id is not None
        or root.deleted_at is not None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thread root not found")

    replies = list(
        (
            await session.execute(
                select(Message)
                .where(
                    Message.thread_root_id == root_id,
                    Message.deleted_at.is_(None),
                )
                .order_by(Message.id.asc())
            )
        )
        .scalars()
        .all()
    )

    attachments = await _attachments_map(session, [root.id, *[r.id for r in replies]])
    return ThreadOut(
        root=_to_out(root, attachments.get(root.id, [])),
        replies=[_to_out(r, attachments.get(r.id, [])) for r in replies],
    )


@router.delete("/{room_id}/messages/{message_id}", status_code=204)
async def delete_message(
    room_id: int,
    message_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Мягкое удаление: автор — своё, admin — любое. Удалённое не попадает в ленту."""
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    message = await session.get(Message, message_id)
    if (
        message is None
        or message.room_id != room_id
        or message.deleted_at is not None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    if message.sender_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot delete this message")

    message.deleted_at = datetime.now(UTC)
    # Симметрично денормализации при ответе — держим «N ответов» правдивым.
    if message.thread_root_id is not None:
        await session.execute(
            update(Message)
            .where(Message.id == message.thread_root_id)
            .values(reply_count=func.greatest(Message.reply_count - 1, 0))
        )
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _unread_count(
    session: AsyncSession, room_id: int, user: User, last_read: int | None
) -> int:
    """Непрочитанные: живые чужие сообщения с id > last_read_message_id (п.4)."""
    result = await session.execute(
        select(func.count())
        .select_from(Message)
        .where(
            Message.room_id == room_id,
            Message.deleted_at.is_(None),
            Message.sender_id != user.id,
            Message.id > (last_read or 0),
        )
    )
    return result.scalar_one()


@router.post("/{room_id}/read", response_model=ReadStateOut)
async def mark_read(
    room_id: int,
    body: ReadRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReadStateOut:
    """Двигать прочтение ВПЕРЁД. Для канала строку членства создаём лениво (п.3)."""
    room = await load_room(session, room_id)
    membership = await assert_room_access(session, room, current_user)

    target = await session.get(Message, body.last_read_message_id)
    if target is None or target.room_id != room_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found in this room")

    if membership is None:
        # Канал: ленивое членство только ради last_read_message_id.
        membership = await get_or_create_channel_membership(session, room, current_user)

    # Только вперёд — не откатываем назад.
    if (membership.last_read_message_id or 0) < body.last_read_message_id:
        membership.last_read_message_id = body.last_read_message_id
    await session.flush()

    unread = await _unread_count(
        session, room_id, current_user, membership.last_read_message_id
    )
    return ReadStateOut(
        room_id=room_id,
        last_read_message_id=membership.last_read_message_id,
        unread_count=unread,
    )
