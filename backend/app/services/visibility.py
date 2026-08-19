"""Двойной фильтр видимости контента по потоку и тарифу (ARG-96).

Применяется только к контенту с НЕЯВНОЙ видимостью «доступно любому активному
участнику»: каналам (ADR-004), common-задачам, материалам базы знаний. Личные/
групповые комнаты и individual/pair/stream-задачи уже гейтятся явным членством
или назначением — этот фильтр их не касается (назначение сильнее потока/тарифа).

NULL `intake_id` и пустой набор строк в `<entity>_plans` — оба означают «доступно
всем» (безопасный дефолт бэкфилла, см. docs/DATA_MODEL.md).
"""
from typing import Any

from sqlalchemy import ColumnElement, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


def intake_visible(content_intake_id: int | None, user: User) -> bool:
    """Виден по потоку: NULL — всем; иначе только участнику того же набора."""
    return content_intake_id is None or content_intake_id == user.intake_id


def plan_visibility_clause(
    plan_id_col: Any,
    entity_id_col: Any,
    entity_pk: Any,
    user_plan_id: int | None,
) -> ColumnElement[bool]:
    """SQL-условие «виден по тарифу» — для WHERE (список) и для point-check (assert).

    `entity_id_col`/`plan_id_col` — колонки таблицы связи (напр. TaskPlan.task_id,
    TaskPlan.plan_id); `entity_pk` — колонка сущности для корреляции в списочном
    запросе (Task.id) либо конкретный id для точечной проверки одной строки.
    """
    restricted = exists().where(entity_id_col == entity_pk)
    if user_plan_id is None:
        return ~restricted
    matched = exists().where(entity_id_col == entity_pk, plan_id_col == user_plan_id)
    return ~restricted | matched


async def plan_visible(
    session: AsyncSession,
    plan_id_col: Any,
    entity_id_col: Any,
    entity_pk: int,
    user_plan_id: int | None,
) -> bool:
    """Point-check «виден по тарифу» — обёртка plan_visibility_clause для одной строки."""
    clause = plan_visibility_clause(plan_id_col, entity_id_col, entity_pk, user_plan_id)
    return bool(await session.scalar(select(clause)))
