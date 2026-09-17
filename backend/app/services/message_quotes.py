"""Цитаты сообщений (Telegram-style «ответить»): messages.quoted_message_id.

Презентационный указатель, ОРТОГОНАЛЬНЫЙ треду (см. docs/DECISIONS.md «Цитата —
отдельное поле, не тред») — не путать с message_refs.py (ссылка на материал КБ /
задачу, цель вне комнаты). Здесь цель ВСЕГДА внутри той же комнаты: зритель уже
прошёл assert_room_access для неё, значит превью цитаты не раскрывает новых прав —
резолв не требует консервативного варианта для broadcast, как у ref.

Две операции:
- `assert_quote_target` — на ОТПРАВКЕ: сообщение существует, из той же комнаты,
  не удалено (анти-IDOR — CLAUDE.md п.1: цитировать чужую комнату нельзя).
- `resolve_message_quotes` — на ЧТЕНИИ: батч-резолв превью для зрителя, живьём
  (не снимок на момент отправки) — правка/удаление оригинала видны сразу везде.
  Фильтр room_id здесь же — защита в глубину на случай кросс-комнатной ссылки.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.schemas.message import QUOTE_PREVIEW_LEN, QuotedMessageOut
from app.services.text_marks import truncate_for_quote


async def assert_quote_target(
    session: AsyncSession, room_id: int, quoted_id: int
) -> Message:
    """Цель цитаты существует, из ТОЙ ЖЕ комнаты, не удалена — иначе 404."""
    target = await session.get(Message, quoted_id)
    if target is None or target.room_id != room_id or target.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Quoted message not found")
    return target


def _quote_kind(message: Message) -> str:
    if message.content:
        return "text"
    if message.sticker_id is not None:
        return "sticker"
    if message.ref_kind is not None:
        return "ref"
    return "attachment"


async def resolve_message_quotes(
    session: AsyncSession, quoted_ids: list[int], room_id: int
) -> dict[int, QuotedMessageOut]:
    """quoted_message_id -> QuotedMessageOut, батчем (без N+1), одним SELECT.

    Отсутствующая строка / чужая комната / мягко удалённая — единообразно отдаётся
    как "deleted" (текст/автор не утекают), фронт рисует «Сообщение удалено».
    """
    unique = {qid for qid in quoted_ids if qid is not None}
    if not unique:
        return {}
    rows = await session.execute(
        select(Message).where(Message.id.in_(unique), Message.room_id == room_id)
    )
    found: dict[int, Message] = {m.id: m for m in rows.scalars().all()}

    result: dict[int, QuotedMessageOut] = {}
    for qid in unique:
        target = found.get(qid)
        if target is None or target.deleted_at is not None:
            result[qid] = QuotedMessageOut(
                id=qid,
                sender_id=None,
                preview=None,
                kind="deleted",
                thread_root_id=None,
                deleted=True,
            )
            continue
        result[qid] = QuotedMessageOut(
            id=target.id,
            sender_id=target.sender_id,
            preview=truncate_for_quote(target.content, QUOTE_PREVIEW_LEN),
            kind=_quote_kind(target),
            thread_root_id=target.thread_root_id,
            deleted=False,
        )
    return result
