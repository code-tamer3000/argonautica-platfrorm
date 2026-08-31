"""Двойной фильтр видимости контента по потоку и тарифу (ARG-96).

Применяется только к контенту с НЕЯВНОЙ видимостью «доступно любому активному
участнику»: каналам (ADR-004), common-задачам, материалам базы знаний. Групповые/
dm-комнаты и individual/pair/stream-задачи уже гейтятся явным членством или
назначением — этот фильтр их не касается (назначение сильнее потока/тарифа).

NULL `intake_id` и пустой набор строк в `<entity>_plans` — оба означают «доступно
всем» (безопасный дефолт бэкфилла, см. docs/DATA_MODEL.md).

Личные дневники (`rooms.is_personal`) — особый случай: они видны не только
владельцу (раздел «Все дневники»), поэтому тоже нуждаются в фильтре, но у самой
комнаты `intake_id` намеренно не проставляется (см. docs/DATA_MODEL.md) — вместо
колонки сравниваются `intake_id`/ранг тарифа владельца и смотрящего напрямую
(`diary_visible`, каскадное правило — см. ниже).

Каскадная видимость по рангу тарифа (ARG-110) — контакты «начать чат»/группа,
асимметрия записи в dm с админом и видимость чужих дневников используют ОДНО
ранговое правило: `cohort_plan_ranks` вычисляет ранги (1..N по возрастанию цены)
среди тарифов, которые реально держат участники потока (`plans` не привязана к
`intakes` FK — состав «тарифов потока» определяется по факту, не по колонке).
Участник ранга R видит участников с рангом <= R того же потока; писать админу
могут только два самых дорогих тарифа (`can_message_admin`); `is_navigator`
обходит это ограничение для конкретного админа. NULL/нет тарифа — ранг 0 (низший).
"""
from typing import Any

from sqlalchemy import ColumnElement, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan import Plan
from app.models.user import User


def intake_visible(content_intake_id: int | None, user: User) -> bool:
    """Виден по потоку: NULL — всем; иначе только участнику того же набора."""
    return content_intake_id is None or content_intake_id == user.intake_id


async def cohort_plan_ranks(session: AsyncSession, intake_id: int | None) -> dict[int, int]:
    """plan_id -> ранг (1..N) среди тарифов потока, отсортированных по цене.

    «Тарифы потока» — не FK-связь (`plans` платформенные, без `intake_id`), а
    тарифы, которые реально держат активные участники этого потока (`is_active`).
    Пустой intake_id или поток без ни одного тарифа — пустая карта (все в нём
    получают ранг 0, см. `user_rank`).
    """
    if intake_id is None:
        return {}
    rows = (
        await session.execute(
            select(Plan.id, Plan.price)
            .join(User, User.plan_id == Plan.id)
            .where(User.intake_id == intake_id, Plan.is_active.is_(True))
            .distinct()
            .order_by(Plan.price, Plan.id)
        )
    ).all()
    return {plan_id: rank for rank, (plan_id, _price) in enumerate(rows, start=1)}


def user_rank(user: User, ranks: dict[int, int]) -> int:
    """Ранг пользователя в своём потоке. Без тарифа или тариф не в карте потока
    (историческая/неактивная запись) — низший ранг 0 (см. «Границы» ARG-110)."""
    if user.plan_id is None:
        return 0
    return ranks.get(user.plan_id, 0)


def can_message_admin(rank: int, ranks: dict[int, int]) -> bool:
    """Право писать НЕ-навигатор-админу — у двух самых дорогих тарифов потока."""
    top = len(ranks)
    return top > 0 and rank >= top - 1


def contact_visible(viewer: User, candidate: User, ranks: dict[int, int]) -> bool:
    """Виден ли candidate в контакт-листе viewer (GET /api/users/contacts,
    POST /api/rooms peer-check) — единое ранговое правило (см. модуль). Только
    для viewer-участника; для admin-виewer решение принимается отдельно на
    вызывающей стороне (админ видит весь поток без рангового ограничения)."""
    if candidate.id == viewer.id:
        return False
    if candidate.intake_id != viewer.intake_id:
        return False
    if candidate.role == "admin":
        if candidate.is_navigator:
            return True
        return can_message_admin(user_rank(viewer, ranks), ranks)
    return user_rank(candidate, ranks) <= user_rank(viewer, ranks)


def diary_visible(owner: User, viewer: User, ranks: dict[int, int]) -> bool:
    """Чужой личный дневник виден, если владелец того же потока и его ранг тарифа
    <= рангу смотрящего (каскад, замена строгому `same_cohort`-равенству)."""
    if owner.intake_id != viewer.intake_id:
        return False
    return user_rank(owner, ranks) <= user_rank(viewer, ranks)


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
