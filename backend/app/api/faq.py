"""FAQ раздела «Поддержка»: частые вопросы + инструкции.

Читать список может любой активный пользователь. Создавать/править/удалять —
только admin (require_admin на каждом авторском эндпоинте, CLAUDE.md п.1).
Структура повторяет календарь: единый роутер, авторские ручки под require_admin,
чтение — под get_current_active_user.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.faq import FaqItem
from app.models.user import User
from app.schemas.faq import FaqItemCreate, FaqItemOut, FaqItemUpdate

router = APIRouter(prefix="/api/faq", tags=["faq"])

_PATCHABLE_FIELDS = {"question", "answer", "sort_order"}


# --- чтение (любой активный участник) --------------------------------------


@router.get("", response_model=list[FaqItemOut])
async def list_faq(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[FaqItem]:
    """Все записи FAQ по порядку (sort_order, затем id)."""
    stmt = select(FaqItem).order_by(FaqItem.sort_order, FaqItem.id)
    return list((await session.execute(stmt)).scalars().all())


# --- авторские эндпоинты (только admin) ------------------------------------


@router.post("", response_model=FaqItemOut, status_code=status.HTTP_201_CREATED)
async def create_faq(
    body: FaqItemCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FaqItem:
    """Создать запись FAQ."""
    item = FaqItem(
        question=body.question, answer=body.answer, sort_order=body.sort_order
    )
    session.add(item)
    await session.flush()
    await session.refresh(item)
    return item


@router.patch("/{faq_id}", response_model=FaqItemOut)
async def update_faq(
    faq_id: int,
    body: FaqItemUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FaqItem:
    """Частичное обновление whitelisted-полей записи FAQ."""
    item = await session.get(FaqItem, faq_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "FAQ item not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        if field in _PATCHABLE_FIELDS:
            setattr(item, field, value)
    await session.flush()
    await session.refresh(item)
    return item


@router.delete("/{faq_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_faq(
    faq_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить запись FAQ."""
    item = await session.get(FaqItem, faq_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "FAQ item not found")
    await session.delete(item)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
