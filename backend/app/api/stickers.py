"""Стикерпаки (§4.5): admin создаёт паки/стикеры, участники читают (для пикера).

Картинки стикеров — media-ассеты (kind=image), presigned-GET подписываем на чтение.
Удаление не делаем: стикеры под FK `messages.sticker_id` — снос ломает историю
(SPEC требует только «добавление admin»).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.media import MediaAsset
from app.models.sticker import Sticker, Stickerpack
from app.models.user import User
from app.schemas.sticker import (
    StickerCreate,
    StickerOut,
    StickerpackCreate,
    StickerpackOut,
)
from app.services.media import presign_asset_urls

router = APIRouter(prefix="/api/stickerpacks", tags=["stickers"])


def _sticker_out(sticker: Sticker, signed: dict[int, str]) -> StickerOut:
    image_url = sticker.image_url
    if sticker.image_media_id is not None:
        image_url = signed.get(sticker.image_media_id)
    return StickerOut(
        id=sticker.id,
        pack_id=sticker.pack_id,
        image_url=image_url,
        keyword=sticker.keyword,
        sort_order=sticker.sort_order,
    )


@router.post("", response_model=StickerpackOut, status_code=201)
async def create_pack(
    body: StickerpackCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StickerpackOut:
    """Создать пак (только admin)."""
    pack = Stickerpack(name=body.name, created_by=current_admin.id)
    session.add(pack)
    await session.flush()
    await session.refresh(pack)
    return StickerpackOut.model_validate(pack)  # stickers по умолчанию []


@router.post("/{pack_id}/stickers", response_model=StickerOut, status_code=201)
async def add_sticker(
    pack_id: int,
    body: StickerCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StickerOut:
    """Добавить стикер в пак: ассет должен существовать и быть image (иначе 404)."""
    if await session.get(Stickerpack, pack_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stickerpack not found")
    asset = await session.get(MediaAsset, body.image_media_id)
    if asset is None or asset.kind != "image":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image asset not found")

    sticker = Sticker(
        pack_id=pack_id,
        image_media_id=body.image_media_id,
        keyword=body.keyword,
        sort_order=body.sort_order,
    )
    session.add(sticker)
    await session.flush()
    await session.refresh(sticker)
    signed = await presign_asset_urls(session, {body.image_media_id})
    return _sticker_out(sticker, signed)


@router.get("", response_model=list[StickerpackOut])
async def list_packs(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[StickerpackOut]:
    """Паки со стикерами (для пикера). Картинки подписаны батчем (без N+1)."""
    packs = list(
        (await session.execute(select(Stickerpack).order_by(Stickerpack.created_at)))
        .scalars()
        .all()
    )
    if not packs:
        return []

    stickers = list(
        (
            await session.execute(
                select(Sticker)
                .where(Sticker.pack_id.in_([p.id for p in packs]))
                .order_by(Sticker.sort_order)
            )
        )
        .scalars()
        .all()
    )
    media_ids = {s.image_media_id for s in stickers if s.image_media_id is not None}
    signed = await presign_asset_urls(session, media_ids)

    by_pack: dict[int, list[StickerOut]] = {}
    for s in stickers:
        by_pack.setdefault(s.pack_id, []).append(_sticker_out(s, signed))

    out: list[StickerpackOut] = []
    for p in packs:
        item = StickerpackOut.model_validate(p)
        item.stickers = by_pack.get(p.id, [])
        out.append(item)
    return out
