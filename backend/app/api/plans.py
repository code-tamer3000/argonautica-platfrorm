"""Публичный список тарифов — все, включая неактивные, только id+name.

Полный CRUD (цена/описание/is_active) — админский, см. `/api/admin/plans`
(app/api/admin.py). Этот роутер существует отдельно для группировки «Все
дневники» по тарифу владельца (RoomOut.owner_plan_id) на клиенте обычного
участника, которому /api/admin/* недоступен (403). `is_active` тут
намеренно не фильтруется: он управляет только тем, предлагает ли тариф
интейк-бот (см. `_active_plans` в backend/scripts/intake_bot.py) — участники,
уже купившие деактивированный тариф, не должны терять подпись своей группы
дневников.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.plan import Plan
from app.models.user import User
from app.schemas.plan import PlanPublicOut

router = APIRouter(prefix="/api/plans", tags=["plans"])


@router.get("", response_model=list[PlanPublicOut])
async def list_plans(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[Plan]:
    """Все тарифы, отсортированы как в админке (по цене) — стабильный
    порядок групп в «Все дневники»."""
    stmt = select(Plan).order_by(Plan.price)
    return list((await session.execute(stmt)).scalars().all())
