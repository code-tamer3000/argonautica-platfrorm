"""Директория пользователей (§4.2): список и публичный профиль.

Платформа закрытая — любой активный участник видит остальных (имена/аватары для
рендера и выбора DM-пира). Свой профиль редактируется в `api/auth.py` (`/api/auth/me`).
Аватар — подписанный media-URL (если задан) или legacy `avatar_url`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.user import PublicUserOut
from app.services.media import presign_asset_urls

router = APIRouter(prefix="/api/users", tags=["users"])


def _public_out(user: User, avatar_url: str | None) -> PublicUserOut:
    return PublicUserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=avatar_url,
        bio=user.bio,
        role=user.role,
    )


def _avatar(user: User, signed: dict[int, str]) -> str | None:
    if user.avatar_media_id is not None:
        return signed.get(user.avatar_media_id)
    return user.avatar_url


@router.get("", response_model=list[PublicUserOut])
async def list_users(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PublicUserOut]:
    """Список пользователей (для ростера / выбора DM-пира). Аватары подписаны батчем."""
    users = list(
        (await session.execute(select(User).order_by(User.display_name)))
        .scalars()
        .all()
    )
    media_ids = {u.avatar_media_id for u in users if u.avatar_media_id is not None}
    signed = await presign_asset_urls(session, media_ids)
    return [_public_out(u, _avatar(u, signed)) for u in users]


@router.get("/{user_id}", response_model=PublicUserOut)
async def get_user(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PublicUserOut:
    """Публичный профиль пользователя."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    media_ids = {user.avatar_media_id} if user.avatar_media_id is not None else set()
    signed = await presign_asset_urls(session, media_ids)
    return _public_out(user, _avatar(user, signed))
