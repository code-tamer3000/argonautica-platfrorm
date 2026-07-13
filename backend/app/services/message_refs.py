"""Ссылки-референсы из сообщений на материал КБ / задачу.

Одна ссылка на сообщение (`messages.ref_kind`/`ref_id`, без FK). Две операции:

- `assert_ref_visible` — на ОТПРАВКЕ: цель существует и видима отправителю (анти-IDOR,
  CLAUDE.md п.1), иначе 404. Нельзя сослаться на черновик КБ / чужую задачу.
- `resolve_message_refs` — на ЧТЕНИИ: батч-резолв title/url + `available` ДЛЯ ЗРИТЕЛЯ.
  Недоступную (снятую с публикации / удалённую / чужую) цель отдаём `available=False`
  и без её заголовка — кнопка в ленте будет неактивна, заголовок не утекает.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kb import KbItem
from app.models.task import Task
from app.models.user import User
from app.schemas.message import MessageRefOut
from app.services.tasks import assert_task_visible

_UNAVAILABLE_TITLE = "Недоступно"


def _ref_url(kind: str, ref_id: int) -> str:
    return f"/kb/{ref_id}" if kind == "kb" else f"/tasks/{ref_id}"


async def _kb_visible(session: AsyncSession, item: KbItem | None, user: User) -> bool:
    return item is not None and (item.published or user.role == "admin")


async def _task_visible(session: AsyncSession, task: Task | None, user: User) -> bool:
    if task is None or task.deleted_at is not None:
        return False
    try:
        await assert_task_visible(session, task, user)
    except HTTPException:
        return False
    return True


async def assert_ref_visible(
    session: AsyncSession, kind: str, ref_id: int, user: User
) -> None:
    """Цель ссылки существует и видима отправителю, иначе 404 (существование цели не
    раскрываем через 403 — как черновик КБ). Вызывается на отправке сообщения."""
    if kind == "kb":
        item = await session.get(KbItem, ref_id)
        if not await _kb_visible(session, item, user):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Referenced item not found")
    elif kind == "task":
        task = await session.get(Task, ref_id)
        if not await _task_visible(session, task, user):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Referenced task not found")
    else:  # pragma: no cover — схема ограничивает kind
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown ref kind")


async def resolve_ref_for_broadcast(
    session: AsyncSession, kind: str, ref_id: int
) -> MessageRefOut:
    """Ссылка для WS-payload `message.new`, который уходит ВСЕМ подписчикам комнаты
    одним телом. Заголовок раскрываем только для универсально видимой цели
    (опубликованный материал / общая задача), иначе отдаём заглушку с `available=False` —
    так название черновика / индивидуальной задачи не утечёт неавторизованному зрителю.
    Клиент, у которого доступ есть, получит корректный title при обычной подгрузке ленты.
    """
    universal = False
    title = _UNAVAILABLE_TITLE
    if kind == "kb":
        item = await session.get(KbItem, ref_id)
        if item is not None and item.published:
            universal, title = True, item.title
    else:
        task = await session.get(Task, ref_id)
        if task is not None and task.deleted_at is None and task.type == "common":
            universal, title = True, task.title
    return MessageRefOut(
        kind=kind, id=ref_id, title=title, url=_ref_url(kind, ref_id), available=universal
    )


async def resolve_message_refs(
    session: AsyncSession,
    refs: list[tuple[str, int]],
    user: User,
) -> dict[tuple[str, int], MessageRefOut]:
    """(kind, id) -> MessageRefOut для зрителя `user`, батчем (без N+1).

    title/available считаются с точки зрения зрителя: цель, к которой у зрителя нет
    доступа (черновик, чужая задача, удалённая), отдаётся `available=False` и с
    заглушкой вместо заголовка.
    """
    unique = set(refs)
    if not unique:
        return {}
    kb_ids = [rid for kind, rid in unique if kind == "kb"]
    task_ids = [rid for kind, rid in unique if kind == "task"]

    kb_items: dict[int, KbItem] = {}
    if kb_ids:
        kb_rows = await session.execute(select(KbItem).where(KbItem.id.in_(kb_ids)))
        kb_items = {it.id: it for it in kb_rows.scalars().all()}
    tasks: dict[int, Task] = {}
    if task_ids:
        task_rows = await session.execute(select(Task).where(Task.id.in_(task_ids)))
        tasks = {t.id: t for t in task_rows.scalars().all()}

    result: dict[tuple[str, int], MessageRefOut] = {}
    for kind, rid in unique:
        if kind == "kb":
            item = kb_items.get(rid)
            available = await _kb_visible(session, item, user)
            title = item.title if (available and item is not None) else _UNAVAILABLE_TITLE
        else:
            task = tasks.get(rid)
            available = await _task_visible(session, task, user)
            title = task.title if (available and task is not None) else _UNAVAILABLE_TITLE
        result[(kind, rid)] = MessageRefOut(
            kind=kind, id=rid, title=title, url=_ref_url(kind, rid), available=available
        )
    return result
