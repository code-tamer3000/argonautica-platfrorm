"""Клуб «Факел» (ARG-54) — пользовательская сторона: только текст заглушки.

Комната клуба — обычная group-комната (`rooms.is_torch=True`, находится клиентом
через `GET /api/rooms`, доступ — стандартный `assert_room_access`/`assert_can_write`,
см. app/services/rooms.py). Отдельный эндпоинт здесь нужен только тем, у кого
`torch_unlocked=False` — им показывать нечего, кроме общего текста заглушки.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.user import User
from app.schemas.torch import TorchStubOut
from app.services.torch import get_or_create_torch_settings

router = APIRouter(prefix="/api/torch", tags=["torch"])


@router.get("/stub", response_model=TorchStubOut)
async def get_torch_stub(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TorchStubOut:
    """Текст заглушки для закрытого клуба — та же видимость, что у пункта меню."""
    if current_user.role != "admin" and current_user.graduated_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available")
    settings = await get_or_create_torch_settings(session)
    return TorchStubOut(stub_text=settings.stub_text)
