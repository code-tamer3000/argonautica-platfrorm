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
колонки сравниваются `intake_id` владельца и смотрящего напрямую (`diary_visible`).
Тариф владельца на видимость дневника НЕ влияет (по решению пользователя дневники
выведены из-под рангового каскада ARG-110, см. ARG-112) — только поток.

Каскадная видимость по рангу тарифа (ARG-110) — контакты «начать чат»/группа и
асимметрия записи в dm с админом используют ОДНО ранговое правило: `cohort_plan_ranks`
вычисляет ранги (1..N по возрастанию цены) среди тарифов, которые реально держат
участники потока (`plans` не привязана к `intakes` FK — состав «тарифов потока»
определяется по факту, не по колонке). Участник ранга R видит участников с рангом
<= R того же потока; писать админу могут только два самых дорогих тарифа
(`can_message_admin`); `is_navigator` обходит это ограничение для конкретного
админа. NULL/нет тарифа — ранг 0 (низший).
"""
from typing import Any

from sqlalchemy import ColumnElement, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan import Plan
from app.models.user import User

# Точное название самого дешёвого тарифа (в оферте — «Позиция»). Держатели этого
# тарифа — вторая, независимая от `is_observer`, группа с урезанным доступом: не
# отображаются в ростере «Аргонавты» (`app/api/argonauts.py`) и видят только свой
# личный дневник, а не «Все дневники» (ARG-114) — см. `is_cheap_tariff` ниже.
CHEAP_TARIFF_NAME = "Наблюдатель"


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


async def is_cheap_tariff(session: AsyncSession, user: User) -> bool:
    """Держатель самого дешёвого тарифа (`CHEAP_TARIFF_NAME`, см. модуль) — для
    дневников ведёт себя как «только своё пространство»: чужие дневники
    («Все дневники») ему не видны, ни в списке, ни прямым GET (иначе IDOR-щель
    в обход списка, CLAUDE.md п.1). Тот же признак решает, где скрывать Zoom-ссылки
    на эфиры (ARG-115/ARG-116, `app/services/redaction.py`) — не только в самой
    Рубке, но и в превью новости на дашборде и в ленте уведомлений."""
    if user.plan_id is None:
        return False
    return bool(
        await session.scalar(
            select(exists().where(Plan.id == user.plan_id, Plan.name == CHEAP_TARIFF_NAME))
        )
    )


async def cheap_tariff_plan_id(session: AsyncSession) -> int | None:
    """Id тарифа `CHEAP_TARIFF_NAME`, если он вообще существует на этом деплое —
    для построения SQL-условий (`Column == cheap_plan_id`), где важна колонка, а не
    point-check одного юзера (см. `is_cheap_tariff` для этого — как `list_rooms`
    гейтит и владельца, и смотрящего дневника, ARG-117)."""
    plan_id: int | None = await session.scalar(
        select(Plan.id).where(Plan.name == CHEAP_TARIFF_NAME)
    )
    return plan_id


async def cheap_tariff_user_ids(session: AsyncSession, user_ids: list[int]) -> set[int]:
    """Батч-вариант `is_cheap_tariff` — какие из user_ids держат дешёвый тариф.
    Нужен там, где решение принимается на много получателей за раз (рассылка
    уведомлений о новости), чтобы не гонять point-check в цикле."""
    if not user_ids:
        return set()
    rows = await session.execute(
        select(User.id)
        .join(Plan, Plan.id == User.plan_id)
        .where(User.id.in_(user_ids), Plan.name == CHEAP_TARIFF_NAME)
    )
    return set(rows.scalars().all())


def diary_visible(owner: User, viewer: User) -> bool:
    """Чужой личный дневник виден, если владелец того же потока — единственное
    ограничение видимости дневника; тариф владельца не учитывается (по решению
    пользователя дневники не подчиняются ранговому каскаду ARG-110).

    Дневник admin-владельца в чужом «Все дневники» не показываем — Динамика не для
    админов, но `create_user` заводит личный канал любому новому аккаунту без учёта
    роли, так что такой дневник может существовать. Не влияет на просмотр СВОЕГО
    дневника (та ветка в assert_room_access/list_rooms не зовёт эту функцию)."""
    if owner.role == "admin":
        return False
    return owner.intake_id == viewer.intake_id


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
