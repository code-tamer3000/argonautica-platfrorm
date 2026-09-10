"""Междумирье — временный грейс-период при понижении с платного тарифа до
самого дешёвого («Наблюдатель»). См. docs/LIMBO.md.

Единственное место на платформе, где значимо «с какого тарифа понизили», а не
только «на каком тарифе сейчас держит» — весь остальной код (см. module
docstring services/visibility.py) сознательно этого не помнит, тариф читается
живьём на каждый запрос. Нет ни одного планировщика в проекте (ни cron, ни
APScheduler/Celery) — 5-дневный срок, как и 28-дневное окно Динамики,
проверяется лениво: по факту следующего авторизованного запроса участника
(`resolve_limbo`, вызывается из `get_current_active_user`), не отдельной
фоновой задачей.
"""
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan import Plan
from app.models.task import Task, TaskAssignment, TaskPlan
from app.models.user import User
from app.services.rooms import resync_dm_memberships_after_plan_change
from app.services.tasks import fan_out_task_event, sync_task_calendar_event
from app.services.visibility import CHEAP_TARIFF_NAME
from app.ws import schemas as ws_schemas

LIMBO_DAYS = 5
MAKEUP_TASK_TITLE = "Опиши весь период последних дней"
MAKEUP_TASK_BODY = (
    "Ты не вёл дневник за прошедший период. Опиши здесь весь этот срок целиком, "
    "одной записью — как будто это дневник сразу за все пропущенные дни."
)


async def _plan_is_cheap(session: AsyncSession, plan_id: int | None) -> bool:
    """Тариф с этим id — самый дешёвый (`CHEAP_TARIFF_NAME`)? Специально не через
    единый резолвленный «id дешёвого тарифа» — `plans.name` не уникален (тестовый
    прогон заводит одноимённый тариф в каждом файле, что уже один раз сломало
    именно этот код: `_cheap_plan_id` молча брал первую попавшуюся строку с
    именем «Наблюдатель», а не ту, что реально держит юзер), тот же риск и в
    проде, если тариф когда-нибудь продублируют. Сравниваем ИМЕННО ЭТОТ id
    напрямую — тот же приём, что `is_cheap_tariff` в services/visibility.py,
    только по голому id, а не по объекту User."""
    if plan_id is None:
        return False
    name: str | None = await session.scalar(select(Plan.name).where(Plan.id == plan_id))
    return name == CHEAP_TARIFF_NAME


async def apply_plan_change(
    session: AsyncSession, admin: User, user: User, old_plan_id: int | None
) -> None:
    """Вызывать из `update_user` ПОСЛЕ того как `user.plan_id` уже присвоено
    новое значение (но до commit) — вместе с `resync_dm_memberships_after_plan_change`,
    как часть той же смены тарифа.

    Если участник уже был в Междумирье — админ вручную вмешался посреди него
    (сменил тариф ещё раз), считаем это его решением и не ждём срока сами:
    снимаем прежнее состояние независимо от того, куда именно перевели теперь.
    Заново входим в Междумирье только если новый тариф — «Наблюдатель», а
    старый (`old_plan_id`) был другим настоящим (платным) тарифом, не пустым и
    не тем же самым «Наблюдателем» — то есть понижение, а не заведение нового
    юзера сразу на дешёвый тариф.
    """
    if user.limbo_deadline_at is not None:
        user.limbo_previous_plan_id = None
        user.limbo_deadline_at = None
        user.limbo_makeup_task_id = None

    entering_limbo = (
        old_plan_id is not None
        and await _plan_is_cheap(session, user.plan_id)
        and not await _plan_is_cheap(session, old_plan_id)
    )
    if not entering_limbo:
        return

    deadline = datetime.now(UTC) + timedelta(days=LIMBO_DAYS)
    task = Task(
        type="individual",
        title=MAKEUP_TASK_TITLE,
        body=MAKEUP_TASK_BODY,
        deadline_at=deadline,
        created_by=admin.id,
        intake_id=user.intake_id,
    )
    session.add(task)
    await session.flush()
    session.add(TaskAssignment(task_id=task.id, user_id=user.id))
    await session.flush()
    await sync_task_calendar_event(session, task)
    await fan_out_task_event(
        session, task, ws_schemas.task_created_event(task.id, task.type, task.title)
    )

    user.limbo_previous_plan_id = old_plan_id
    user.limbo_deadline_at = deadline
    user.limbo_makeup_task_id = task.id
    # Сбросить «не показывать снова» с прошлого захода в Междумирье (если был) —
    # у каждого нового захода поп-ап должен показаться заново, а не молчать
    # навсегда из-за галочки, снятой в прошлый раз (см. LimboPopup.tsx).
    user.settings = {**user.settings, "limbo_popup_dismissed": False}


async def _has_unfinished_common_tasks(session: AsyncSession, user: User) -> bool:
    """Остались ли непринятые/несданные common-задачи, ПОМЕЧЕННЫЕ прошлым
    тарифом — специально ТОЛЬКО помеченные (`exists TaskPlan`), не общий
    `plan_visibility_clause`: тот трактует пустой `task_plans` как «видна
    всем», а незавершённая универсальная задача (не эксклюзив прошлого
    тарифа) была видна и до, и после понижения одинаково — требовать её
    закрытия ради возврата тарифа было бы посторонним условием."""
    unfinished = await session.scalar(
        select(Task.id)
        .outerjoin(
            TaskAssignment,
            (TaskAssignment.task_id == Task.id) & (TaskAssignment.user_id == user.id),
        )
        .where(
            Task.type == "common",
            Task.deleted_at.is_(None),
            or_(Task.intake_id.is_(None), Task.intake_id == user.intake_id),
            exists().where(
                TaskPlan.task_id == Task.id,
                TaskPlan.plan_id == user.limbo_previous_plan_id,
            ),
            or_(
                TaskAssignment.status.is_(None),
                TaskAssignment.status.in_(("assigned", "returned")),
            ),
        )
        .limit(1)
    )
    return unfinished is not None


async def _requirements_met(session: AsyncSession, user: User) -> bool:
    if user.limbo_makeup_task_id is not None:
        makeup_status = await session.scalar(
            select(TaskAssignment.status).where(
                TaskAssignment.task_id == user.limbo_makeup_task_id,
                TaskAssignment.user_id == user.id,
            )
        )
        if makeup_status not in ("submitted", "accepted"):
            return False
    return not await _has_unfinished_common_tasks(session, user)


async def resolve_limbo(session: AsyncSession, user: User) -> None:
    """Ленивая проверка на каждый запрос — реально что-то делает только если
    `limbo_deadline_at` не NULL (для всех остальных — одно сравнение колонки).

    Успел закрыть допзадание и все задачи прошлого тарифа — тариф
    восстанавливается сразу, не дожидаясь самого дедлайна (дедлайн — крайний
    срок, а не момент проверки). Не успел и срок уже прошёл — Междумирье
    снимается, участник остаётся на «Наблюдателе» без спецдоступа к тем
    задачам (`_effective_plan_id` в services/tasks.py перестаёт их показывать).
    """
    if user.limbo_deadline_at is None:
        return
    if await _requirements_met(session, user):
        user.plan_id = user.limbo_previous_plan_id
        user.limbo_previous_plan_id = None
        user.limbo_deadline_at = None
        user.limbo_makeup_task_id = None
        await session.flush()
        await resync_dm_memberships_after_plan_change(session, user)
        return
    if datetime.now(UTC) >= user.limbo_deadline_at:
        user.limbo_previous_plan_id = None
        user.limbo_deadline_at = None
        user.limbo_makeup_task_id = None
        await session.flush()
