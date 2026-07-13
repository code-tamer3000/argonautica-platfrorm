"""Сообщения, треды, мягкое удаление и статусы прочтения.

Доступ проверяется на сервере на КАЖДОМ действии (CLAUDE.md п.1) через
`app.services.rooms`. Треды плоские (п.2): ответ всегда привязан к КОРНЮ, не к
другому ответу. Удаление мягкое (п.6). Прочтения — через `last_read_message_id`
без отдельной таблицы (п.4).
"""
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Date as SqlDate
from sqlalchemy import cast, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_session
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.sticker import Sticker
from app.models.user import User
from app.schemas.media import AttachmentOut
from app.schemas.message import (
    EditMessageRequest,
    MessageOut,
    MessageRefOut,
    PinnedOut,
    ReadRequest,
    ReadStateOut,
    SendMessageRequest,
    ThreadOut,
)
from app.services.media import resolve_attachments
from app.services.message_refs import (
    assert_ref_visible,
    resolve_message_refs,
    resolve_ref_for_broadcast,
)
from app.services.notifications import on_new_message
from app.services.ratelimit import enforce_rate_limit
from app.services.rooms import (
    assert_can_pin,
    assert_room_access,
    ensure_news_channel,
    get_or_create_channel_membership,
    load_room,
)
from app.ws import schemas as ws_schemas
from app.ws.pubsub import publish_room_event

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


async def _unread_replies_map(
    session: AsyncSession, root_ids: list[int], last_read: int
) -> dict[int, int]:
    """root_id -> число непрочитанных ответов (id > last_read), одним запросом.

    Читает только ответы новее курсора: для роста непрочитанных нужен count, для
    уже прочитанных треды в выборку не попадают. Удалённые не считаем. last_read=0
    (канал без строки членства / ни разу не читал) — считаются все ответы.
    """
    if not root_ids:
        return {}
    rows = await session.execute(
        select(Message.thread_root_id, func.count())
        .where(
            Message.thread_root_id.in_(root_ids),
            Message.id > last_read,
            Message.deleted_at.is_(None),
        )
        .group_by(Message.thread_root_id)
    )
    return {root_id: count for root_id, count in rows.all()}


async def _refs_map(
    session: AsyncSession, messages: list[Message], viewer: User
) -> dict[tuple[str, int], MessageRefOut]:
    """Разрешить ссылки всех сообщений батчем для зрителя (title/url/available)."""
    refs = [
        (m.ref_kind, m.ref_id)
        for m in messages
        if m.ref_kind is not None and m.ref_id is not None
    ]
    if not refs:
        return {}
    return await resolve_message_refs(session, refs, viewer)


def _to_out(
    message: Message,
    attachments: list[AttachmentOut],
    refs: dict[tuple[str, int], MessageRefOut] | None = None,
) -> MessageOut:
    out = MessageOut.model_validate(message)
    out.attachments = attachments
    # attachment_ids — для обратной совместимости со старыми клиентами (см. схему).
    out.attachment_ids = [att.asset_id for att in attachments]
    if message.ref_kind is not None and message.ref_id is not None and refs is not None:
        out.ref = refs.get((message.ref_kind, message.ref_id))
    return out


def _pinned_out(
    pin: PinnedMessage,
    message: Message,
    attachments: list[AttachmentOut],
    refs: dict[tuple[str, int], MessageRefOut] | None = None,
) -> PinnedOut:
    return PinnedOut(
        room_id=pin.room_id,
        message_id=pin.message_id,
        pinned_by=pin.pinned_by,
        pinned_at=pin.pinned_at,
        message=_to_out(message, attachments, refs),
    )


@router.post("/{room_id}/messages", response_model=MessageOut, status_code=201)
async def send_message(
    room_id: int,
    body: SendMessageRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageOut:
    """Отправить сообщение (текст / стикер / вложения), опционально — ответ в тред."""
    await enforce_rate_limit(
        f"rl:send:{current_user.id}", settings.rate_limit_send_per_minute
    )
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    # Личный канал: верхнеуровневые сообщения только от владельца.
    # Thread-ответы (reply_to_message_id задан) разрешены всем — это «комментарии».
    if room.is_personal and room.created_by != current_user.id:
        if body.reply_to_message_id is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Only the channel owner can post here; use threads to comment",
            )

    # Новостной канал: верхнеуровневые посты — только admin. Комментарии (треды) — все.
    if room.is_news and current_user.role != "admin":
        if body.reply_to_message_id is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Only admins can post to the news channel; use threads to comment",
            )

    if body.sticker_id is not None and await session.get(Sticker, body.sticker_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sticker not found")

    if body.attachment_ids:
        # Прикрепить можно только свои ассеты (нельзя подставить чужой id — IDOR).
        found = await session.execute(
            select(MediaAsset.id).where(
                MediaAsset.id.in_(body.attachment_ids),
                MediaAsset.created_by == current_user.id,
            )
        )
        if set(found.scalars().all()) != set(body.attachment_ids):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")

    # Ссылка на материал/задачу: цель должна существовать и быть видимой отправителю
    # (анти-IDOR — нельзя сослаться на черновик КБ / чужую задачу).
    if body.ref_kind is not None and body.ref_id is not None:
        await assert_ref_visible(session, body.ref_kind, body.ref_id, current_user)

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
        ref_kind=body.ref_kind,
        ref_id=body.ref_id,
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
    resolved = await resolve_attachments(session, [message.id])
    refs = await _refs_map(session, [message], current_user)
    out = _to_out(message, resolved.get(message.id, []), refs)
    # Живая доставка подписчикам комнаты (payload самодостаточный). Ссылку в
    # broadcast резолвим консервативно (заголовок только для универсально видимой
    # цели) — payload один на всех, нельзя раскрыть чужой черновик.
    ws_out = _to_out(message, resolved.get(message.id, []))
    if message.ref_kind is not None and message.ref_id is not None:
        ws_out.ref = await resolve_ref_for_broadcast(
            session, message.ref_kind, message.ref_id
        )
    await publish_room_event(room_id, ws_schemas.message_new_event(ws_out))
    # Уведомления получателям (личка / ответ на сообщение / пост в новостях).
    await on_new_message(session, message, room, current_user)
    return out


@router.post(
    "/{room_id}/messages/{message_id}/repost",
    response_model=MessageOut,
    status_code=201,
)
async def repost_to_news(
    room_id: int,
    message_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageOut:
    """Репост сообщения в новостной канал (только admin).

    Копируем текст/стикер/вложения в новый верхнеуровневый пост новостного канала,
    сохраняя исходного автора в forwarded_from_sender_id (атрибуция «переслано от X»).
    Доступ к исходной комнате проверяется как везде (п.1). Проверку владения ассетом
    (в отличие от send_message) не делаем — это админский репост; доступ к медиа у
    зрителей новостей отработает через assert_media_access (медиа привязано к живому
    сообщению в доступной комнате).
    """
    if current_user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can repost to the news channel"
        )

    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    source = await session.get(Message, message_id)
    if (
        source is None
        or source.room_id != room_id
        or source.deleted_at is not None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    news = await ensure_news_channel(session)
    if news is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "News channel is not ready yet"
        )
    if source.room_id == news.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Message is already in the news channel"
        )

    attachment_ids = (await _attachments_map(session, [source.id])).get(source.id, [])

    repost = Message(
        room_id=news.id,
        sender_id=current_user.id,
        content=source.content,
        sticker_id=source.sticker_id,
        # Цепочка репостов сохраняет ПЕРВОГО автора, а не промежуточного репостера.
        forwarded_from_sender_id=source.forwarded_from_sender_id or source.sender_id,
        # Ссылка на материал/задачу переносится вместе с репостом.
        ref_kind=source.ref_kind,
        ref_id=source.ref_id,
    )
    session.add(repost)
    await session.flush()

    for media_asset_id in attachment_ids:
        session.add(
            MessageAttachment(message_id=repost.id, media_asset_id=media_asset_id)
        )

    await session.flush()
    await session.refresh(repost)
    resolved = await resolve_attachments(session, [repost.id])
    refs = await _refs_map(session, [repost], current_user)
    out = _to_out(repost, resolved.get(repost.id, []), refs)
    ws_out = _to_out(repost, resolved.get(repost.id, []))
    if repost.ref_kind is not None and repost.ref_id is not None:
        ws_out.ref = await resolve_ref_for_broadcast(
            session, repost.ref_kind, repost.ref_id
        )
    await publish_room_event(news.id, ws_schemas.message_new_event(ws_out))
    # Репост — новый верхнеуровневый пост в новостях: уведомить всех участников.
    await on_new_message(session, repost, news, current_user)
    return out


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
    membership = await assert_room_access(session, room, current_user)
    last_read = (membership.last_read_message_id or 0) if membership else 0

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
    attachments = await resolve_attachments(session, [m.id for m in messages])
    refs = await _refs_map(session, messages, current_user)
    # Непрочитанные ответы в тредах — только для корней с ответами (иначе лишний скан).
    roots_with_replies = [m.id for m in messages if m.reply_count > 0]
    unread = await _unread_replies_map(session, roots_with_replies, last_read)
    out = []
    for m in messages:
        item = _to_out(m, attachments.get(m.id, []), refs)
        item.unread_reply_count = unread.get(m.id, 0)
        out.append(item)
    return out


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

    attachments = await resolve_attachments(
        session, [root.id, *[r.id for r in replies]]
    )
    refs = await _refs_map(session, [root, *replies], current_user)
    return ThreadOut(
        root=_to_out(root, attachments.get(root.id, []), refs),
        replies=[_to_out(r, attachments.get(r.id, []), refs) for r in replies],
    )


@router.patch("/{room_id}/messages/{message_id}", response_model=MessageOut)
async def edit_message(
    room_id: int,
    message_id: int,
    body: EditMessageRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageOut:
    """Правка текста: ТОЛЬКО автор (admin чужой текст не переписывает — в отличие от
    удаления). Стикер/вложение-only править нечего → 400. Удалённое → 404."""
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    message = await session.get(Message, message_id)
    if (
        message is None
        or message.room_id != room_id
        or message.deleted_at is not None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    if message.sender_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this message")
    if message.content is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only text messages can be edited"
        )

    message.content = body.content
    message.edited_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(message)

    attachments = await resolve_attachments(session, [message.id])
    refs = await _refs_map(session, [message], current_user)
    out = _to_out(message, attachments.get(message.id, []), refs)
    ws_out = _to_out(message, attachments.get(message.id, []))
    if message.ref_kind is not None and message.ref_id is not None:
        ws_out.ref = await resolve_ref_for_broadcast(
            session, message.ref_kind, message.ref_id
        )
    await publish_room_event(room_id, ws_schemas.message_edited_event(ws_out))
    return out


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
    # Целостность: удалённое сообщение не должно оставаться закреплённым.
    pin = await session.get(PinnedMessage, (room_id, message_id))
    if pin is not None:
        await session.delete(pin)
    await session.flush()
    if pin is not None:
        await publish_room_event(
            room_id, ws_schemas.pin_removed_event(room_id, message_id)
        )
    await publish_room_event(
        room_id, ws_schemas.message_deleted_event(room_id, message_id)
    )
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
    # Read-receipt: подписчики комнаты узнают, до какого места дочитал юзер.
    await publish_room_event(
        room_id,
        ws_schemas.read_event(
            room_id, current_user.id, membership.last_read_message_id
        ),
    )
    return ReadStateOut(
        room_id=room_id,
        last_read_message_id=membership.last_read_message_id,
        unread_count=unread,
    )


# --- закрепления (pins, SPEC §4.7) -----------------------------------------


@router.post(
    "/{room_id}/messages/{message_id}/pin",
    response_model=PinnedOut,
    status_code=201,
)
async def pin_message(
    room_id: int,
    message_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> PinnedOut:
    """Закрепить сообщение. Право — owner/admin (для dm — любой участник). Идемпотентно."""
    room = await load_room(session, room_id)
    membership = await assert_room_access(session, room, current_user)
    assert_can_pin(room, current_user, membership)

    message = await session.get(Message, message_id)
    if (
        message is None
        or message.room_id != room_id
        or message.deleted_at is not None
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    pin = await session.get(PinnedMessage, (room_id, message_id))
    if pin is not None:
        response.status_code = status.HTTP_200_OK  # уже закреплено — не дублим
    else:
        pin = PinnedMessage(
            room_id=room_id, message_id=message_id, pinned_by=current_user.id
        )
        session.add(pin)
        await session.flush()
        await session.refresh(pin)
        response.status_code = status.HTTP_201_CREATED
        await publish_room_event(
            room_id,
            ws_schemas.pin_added_event(room_id, message_id, current_user.id),
        )

    attachments = await resolve_attachments(session, [message.id])
    refs = await _refs_map(session, [message], current_user)
    return _pinned_out(pin, message, attachments.get(message.id, []), refs)


@router.delete(
    "/{room_id}/messages/{message_id}/pin",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unpin_message(
    room_id: int,
    message_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Открепить сообщение. Право — то же, что и для закрепления."""
    room = await load_room(session, room_id)
    membership = await assert_room_access(session, room, current_user)
    assert_can_pin(room, current_user, membership)

    pin = await session.get(PinnedMessage, (room_id, message_id))
    if pin is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pin not found")

    await session.delete(pin)
    await session.flush()
    await publish_room_event(
        room_id, ws_schemas.pin_removed_event(room_id, message_id)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{room_id}/pins", response_model=list[PinnedOut])
async def list_pins(
    room_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PinnedOut]:
    """Список закреплённых (любой участник комнаты). Удалённые не показываем."""
    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    rows = await session.execute(
        select(PinnedMessage, Message)
        .join(Message, Message.id == PinnedMessage.message_id)
        .where(
            PinnedMessage.room_id == room_id,
            Message.deleted_at.is_(None),
        )
        .order_by(PinnedMessage.pinned_at.desc())
    )
    pairs = list(rows.all())
    attachments = await resolve_attachments(session, [m.id for _, m in pairs])
    refs = await _refs_map(session, [m for _, m in pairs], current_user)
    return [
        _pinned_out(p, m, attachments.get(m.id, []), refs) for p, m in pairs
    ]


@router.get("/{room_id}/journal-days", response_model=dict[str, list[str]])
async def get_journal_days(
    room_id: int,
    year: Annotated[int, Query(ge=2020, le=2100)],
    month: Annotated[int, Query(ge=1, le=12)],
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, list[str]]:
    """Карта {дата YYYY-MM-DD: [ключи разделов]} за месяц — для дневника/календаря.

    День закрыт, когда за сутки опубликованы все разделы задания, активного в этот
    день (набор разделов может меняться между заданиями — см. dynamics.load_timeline).
    """
    # Маркер категории и шкала заданий живут в dynamics — единый источник правды.
    from app.api.dynamics import _journal_category, active_version_for, load_timeline

    room = await load_room(session, room_id)
    await assert_room_access(session, room, current_user)

    start = datetime(year, month, 1, tzinfo=UTC)
    end = (
        datetime(year + 1, 1, 1, tzinfo=UTC)
        if month == 12
        else datetime(year, month + 1, 1, tzinfo=UTC)
    )

    timeline = await load_timeline(session)
    rows = await session.execute(
        select(cast(Message.created_at, SqlDate), Message.content)
        .where(
            Message.room_id == room_id,
            Message.deleted_at.is_(None),
            Message.thread_root_id.is_(None),
            Message.created_at >= start,
            Message.created_at < end,
        )
    )
    per_day: dict[date, set[str]] = {}
    for day, content in rows.all():
        cat = _journal_category(content)
        if cat is None:
            continue
        per_day.setdefault(day, set()).add(cat)

    # Порядок ключей в дне — по позициям разделов задания, активного В ЭТОТ день.
    def _ordered(day: date, cats: set[str]) -> list[str]:
        version = active_version_for(day, timeline)
        order = version.order if version else {}
        return sorted(cats, key=lambda c: (order.get(c, len(order)), c))

    return {str(day): _ordered(day, cats) for day, cats in per_day.items()}
