"""Веб-воронка приёма (ARG-107): read-only CRM-проекция intake_applications для
админа. Заявку по-прежнему двигает только Telegram-бот (ARG-92) — здесь нет ни
одного мутирующего эндпоинта, только просмотр.
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.db.session import get_session
from app.models.intake_application import IntakeApplication
from app.models.plan import Plan
from app.schemas.intake_application import (
    FUNNEL_STATUSES,
    ApplicationFunnelOut,
    ApplicationOut,
)

# Заявок — десятки (проект на 20–30 участников набора), канбан всё равно рисует
# все стадии разом: без пагинации, с жёстким верхним пределом на всякий случай.
_MAX_ITEMS = 500

router = APIRouter(
    prefix="/api/admin/applications",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


def _display_name(app: IntakeApplication) -> str:
    parts = [p for p in (app.tg_first_name, app.tg_last_name) if p]
    if parts:
        return " ".join(parts)
    return f"@{app.tg_username}" if app.tg_username else f"tg{app.tg_id}"


# Таймстемп входа в текущую стадию — для «сколько дней висит здесь». awaiting_offer
# намеренно читает receipt_at из awaiting_receipt (нет отдельной колонки — офер и
# приём чека делят offer_accepted_at, см. app/models/intake_application.py).
_STAGE_TIMESTAMP: dict[str, str] = {
    "awaiting_about": "created_at",
    "submitted": "submitted_at",
    "choosing_plan": "accepted_at",
    "awaiting_offer": "plan_chosen_at",
    "awaiting_receipt": "offer_accepted_at",
    "payment_review": "receipt_at",
    "confirmed": "confirmed_at",
    "expired": "expired_at",  # ARG-108: бронь сгорела до оплаты
}


def _to_out(app: IntakeApplication, plan: Plan | None) -> ApplicationOut:
    stage_since = getattr(app, _STAGE_TIMESTAMP[app.status], None)
    days_in_stage = (datetime.now(UTC) - stage_since).days if stage_since else None
    return ApplicationOut(
        id=app.id,
        tg_id=app.tg_id,
        tg_username=app.tg_username,
        tg_first_name=app.tg_first_name,
        tg_last_name=app.tg_last_name,
        display_name=_display_name(app),
        status=app.status,
        about=app.about,
        plan_id=app.plan_id,
        plan_name=plan.name if plan else None,
        plan_price=plan.price if plan else None,
        has_receipt=app.receipt_file_id is not None,
        receipt_kind=app.receipt_kind,
        offer_version=app.offer_version,
        user_id=app.user_id,
        created_at=app.created_at,
        submitted_at=app.submitted_at,
        accepted_at=app.accepted_at,
        plan_chosen_at=app.plan_chosen_at,
        offer_accepted_at=app.offer_accepted_at,
        receipt_at=app.receipt_at,
        confirmed_at=app.confirmed_at,
        expired_at=app.expired_at,
        updated_at=app.updated_at,
        stage_since=stage_since,
        days_in_stage=days_in_stage,
    )


@router.get("", response_model=ApplicationFunnelOut)
async def list_applications(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ApplicationFunnelOut:
    by_status = dict.fromkeys(FUNNEL_STATUSES, 0)
    counts_stmt = select(
        IntakeApplication.status, func.count(IntakeApplication.id)
    ).group_by(IntakeApplication.status)
    for status_value, count in (await session.execute(counts_stmt)).all():
        by_status[status_value] = count
    total = sum(by_status.values())

    stmt = (
        select(IntakeApplication, Plan)
        .outerjoin(Plan, IntakeApplication.plan_id == Plan.id)
        .order_by(IntakeApplication.created_at.desc())
        .limit(_MAX_ITEMS)
    )
    rows = (await session.execute(stmt)).all()
    items = [_to_out(app, plan) for app, plan in rows]

    return ApplicationFunnelOut(total=total, by_status=by_status, items=items)
