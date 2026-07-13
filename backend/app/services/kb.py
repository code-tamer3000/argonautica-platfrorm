"""Доступ к материалам базы знаний — единая точка для роутера KB.

Авторизация на КАЖДОМ запросе (CLAUDE.md п.1). Чтение материалов: участник видит
только опубликованные; admin видит любые (в т.ч. черновики). Существование черновика
наружу не раскрываем — для не-admin он 404, а не 403.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kb import KbCategory, KbItem, KbItemMedia
from app.models.user import User


async def assert_category_exists(
    session: AsyncSession, category_id: int | None
) -> None:
    """Категория (если задана) должна существовать, иначе 404. NULL — валиден."""
    if category_id is None:
        return
    if await session.get(KbCategory, category_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KB category not found")


async def load_kb_item(session: AsyncSession, item_id: int) -> KbItem:
    """Материал существует, иначе 404."""
    item = await session.get(KbItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KB item not found")
    return item


def assert_kb_item_visible(item: KbItem, user: User) -> None:
    """Не-admin видит только опубликованное; черновик для него — 404 (не раскрываем)."""
    if not item.published and user.role != "admin":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KB item not found")


async def attached_media_ids(
    session: AsyncSession, item_ids: list[int]
) -> dict[int, list[int]]:
    """kb_item_id -> [media_asset_id, ...] одним запросом (без N+1)."""
    if not item_ids:
        return {}
    rows = await session.execute(
        select(KbItemMedia.kb_item_id, KbItemMedia.media_asset_id)
        .where(KbItemMedia.kb_item_id.in_(item_ids))
        .order_by(KbItemMedia.media_asset_id)
    )
    result: dict[int, list[int]] = {}
    for kb_item_id, media_asset_id in rows.all():
        result.setdefault(kb_item_id, []).append(media_asset_id)
    return result
