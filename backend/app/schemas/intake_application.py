"""Pydantic-схемы веб-воронки приёма (ARG-107) — read-only проекция intake_applications
для CRM-дашборда админа. Двигать заявку по-прежнему можно только из Telegram-бота
(ARG-92) — здесь нет ни одного мутирующего эндпоинта.
"""
from datetime import datetime

from pydantic import BaseModel, ConfigDict

# Порядок стадий — совпадает с CheckConstraint в app/models/intake_application.py.
FUNNEL_STATUSES: tuple[str, ...] = (
    "awaiting_about",
    "submitted",
    "choosing_plan",
    "awaiting_offer",
    "awaiting_receipt",
    "payment_review",
    "confirmed",
)


class ApplicationOut(BaseModel):
    """Одна заявка. `stage_since`/`days_in_stage` вычисляются на бэке (см.
    api/applications.py) — фронт не должен считать даты сам.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    tg_id: int
    tg_username: str | None
    tg_first_name: str | None
    tg_last_name: str | None
    display_name: str
    status: str
    about: str | None
    plan_id: int | None
    plan_name: str | None
    plan_price: int | None
    has_receipt: bool
    receipt_kind: str | None
    offer_version: str | None
    user_id: int | None
    created_at: datetime
    submitted_at: datetime | None
    accepted_at: datetime | None
    plan_chosen_at: datetime | None
    offer_accepted_at: datetime | None
    receipt_at: datetime | None
    confirmed_at: datetime | None
    updated_at: datetime
    stage_since: datetime | None
    days_in_stage: int | None


class ApplicationFunnelOut(BaseModel):
    """Ответ `GET /api/admin/applications`."""

    total: int
    by_status: dict[str, int]
    items: list[ApplicationOut]
