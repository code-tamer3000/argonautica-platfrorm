"""База знаний (SPEC §4.9): авторский CRUD материалов + чтение опубликованного.

Материалы создаёт/правит только admin; участники читают опубликованное. Категории —
вне MVP (DECISIONS.md), материалы плоские. Файлы/видео грузятся обычным media-flow
(`/api/media/...`) и линкуются к материалу. Авторизация на КАЖДОМ запросе (CLAUDE.md п.1).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.kb import KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.user import User
from app.schemas.kb import (
    AttachMediaRequest,
    KbItemCreate,
    KbItemOut,
    KbItemUpdate,
)
from app.services.kb import assert_kb_item_visible, attached_media_ids, load_kb_item

router = APIRouter(prefix="/api/kb", tags=["kb"])

# Поля, которые admin вправе править через PATCH.
_PATCHABLE_FIELDS = {"title", "body", "published", "sort_order"}


def _to_out(item: KbItem, media_ids: list[int]) -> KbItemOut:
    out = KbItemOut.model_validate(item)
    out.media_asset_ids = media_ids
    return out


async def _assert_assets_exist(session: AsyncSession, asset_ids: list[int]) -> None:
    """Все переданные media_asset_id должны существовать, иначе 404."""
    if not asset_ids:
        return
    found = await session.execute(
        select(MediaAsset.id).where(MediaAsset.id.in_(asset_ids))
    )
    if set(found.scalars().all()) != set(asset_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")


# --- авторские эндпоинты (только admin) ------------------------------------


@router.post("/items", response_model=KbItemOut, status_code=201)
async def create_item(
    body: KbItemCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Создать материал (по умолчанию черновик). Опционально привязать медиа."""
    await _assert_assets_exist(session, body.media_asset_ids)

    item = KbItem(
        title=body.title,
        body=body.body,
        published=body.published,
        created_by=current_admin.id,
    )
    session.add(item)
    await session.flush()

    for asset_id in dict.fromkeys(body.media_asset_ids):  # без дублей
        session.add(KbItemMedia(kb_item_id=item.id, media_asset_id=asset_id))
    await session.flush()
    await session.refresh(item)

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


@router.patch("/items/{item_id}", response_model=KbItemOut)
async def update_item(
    item_id: int,
    body: KbItemUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Частичное обновление: применяем только переданные whitelisted-поля."""
    item = await load_kb_item(session, item_id)

    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(item, field, value)
    if changes:
        item.updated_at = datetime.now(UTC)
    await session.flush()

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить материал и его связи с медиа (физически — у kb_items нет deleted_at)."""
    item = await load_kb_item(session, item_id)

    # Сначала дочерние связи (явный bulk-DELETE), затем сам материал — иначе FK.
    await session.execute(
        sa_delete(KbItemMedia).where(KbItemMedia.kb_item_id == item_id)
    )
    await session.delete(item)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/items/{item_id}/media", response_model=KbItemOut)
async def attach_media(
    item_id: int,
    body: AttachMediaRequest,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Привязать медиа к материалу (идемпотентно). 404, если ассета нет."""
    item = await load_kb_item(session, item_id)
    await _assert_assets_exist(session, body.media_asset_ids)

    for asset_id in dict.fromkeys(body.media_asset_ids):
        if await session.get(KbItemMedia, (item_id, asset_id)) is None:
            session.add(KbItemMedia(kb_item_id=item_id, media_asset_id=asset_id))
    await session.flush()

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)


@router.delete("/items/{item_id}/media/{media_asset_id}", status_code=204)
async def detach_media(
    item_id: int,
    media_asset_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Отвязать медиа от материала. 404, если связи нет."""
    await load_kb_item(session, item_id)

    link = await session.get(KbItemMedia, (item_id, media_asset_id))
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media not attached to this item")
    await session.delete(link)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- чтение (любой активный участник) --------------------------------------


@router.get("/items", response_model=list[KbItemOut])
async def list_items(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[KbItemOut]:
    """Список материалов: участник — только опубликованные; admin — все."""
    stmt = select(KbItem).order_by(KbItem.sort_order, KbItem.created_at)
    if current_user.role != "admin":
        stmt = stmt.where(KbItem.published.is_(True))

    items = list((await session.execute(stmt)).scalars().all())
    media = await attached_media_ids(session, [i.id for i in items])
    return [_to_out(i, media.get(i.id, [])) for i in items]


@router.get("/items/{item_id}", response_model=KbItemOut)
async def get_item(
    item_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> KbItemOut:
    """Один материал. Черновик виден только admin (иначе 404)."""
    item = await load_kb_item(session, item_id)
    assert_kb_item_visible(item, current_user)

    media_ids = (await attached_media_ids(session, [item.id])).get(item.id, [])
    return _to_out(item, media_ids)
