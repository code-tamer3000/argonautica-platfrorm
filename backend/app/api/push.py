"""Регистрация браузерных push-подписок (Web Push / VAPID).

Публичный ключ VAPID отдаём фронту, чтобы браузер оформил подписку; её присылают
назад и мы сохраняем (по одной на устройство). Всё — только для текущего юзера
(п.1: не доверяем id от клиента). Если ключи VAPID не заданы (dev) — 503.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_session
from app.models.user import User
from app.schemas.push import (
    PushSubscribeRequest,
    PushUnsubscribeRequest,
    VapidKeyOut,
)
from app.services.push import delete_subscription, save_subscription

router = APIRouter(prefix="/api/push", tags=["push"])


def _require_push_configured() -> None:
    if not settings.push_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Push notifications are not configured"
        )


@router.get("/vapid-key", response_model=VapidKeyOut)
async def vapid_key(
    _: Annotated[User, Depends(get_current_active_user)],
) -> VapidKeyOut:
    """Публичный VAPID-ключ для `pushManager.subscribe` на фронте."""
    _require_push_configured()
    return VapidKeyOut(public_key=settings.vapid_public_key)


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
async def subscribe(
    body: PushSubscribeRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Сохранить подписку этого браузера/устройства. Идемпотентно по endpoint."""
    _require_push_configured()
    await save_subscription(
        session,
        user_id=current_user.id,
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
        user_agent=body.user_agent,
    )


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe(
    body: PushUnsubscribeRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Удалить подписку по endpoint (только свою). Идемпотентно."""
    await delete_subscription(session, current_user.id, body.endpoint)
