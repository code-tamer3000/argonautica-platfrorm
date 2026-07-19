"""Бизнес-логика раздела «Задачи»: видимость, ленивые назначения, прогресс,
синхронизация дедлайн-событий календаря, фан-аут WS.

Авторизация на КАЖДОМ запросе (CLAUDE.md п.1, анти-IDOR): видимость задачи и её
сдач всегда проверяется на сервере, id от клиента не доверяем. Общая задача видна
любому активному участнику; индивидуальная — только адресатам и админу. Назначения
общих задач создаём лениво (как ленивое членство в каналах, п.3).
"""
import logging
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import CalendarEvent
from app.models.task import (
    Task,
    TaskAssignment,
    TaskPair,
    TaskPairMember,
    TaskStreamNodeMember,
)
from app.models.user import User
from app.services import stream as stream_service
from app.ws.pubsub import publish_user_event

logger = logging.getLogger(__name__)


async def load_task(session: AsyncSession, task_id: int) -> Task:
    """Задача существует и не удалена, иначе 404."""
    task = await session.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


async def assert_task_visible(
    session: AsyncSession, task: Task, user: User
) -> None:
    """Проверить видимость задачи для юзера (анти-IDOR, п.1).

    common → видна любому активному участнику; admin → всё. Иначе:
    - individual → у юзера есть строка task_assignments (адресат), ИЛИ юзер — автор
      перекрёстной задачи (created_by, задачу партнёру выдаёт участник);
    - pair → юзер состоит в одной из пар этого задания (task_pair_members);
    - stream → юзер входит в сетку потока (task_stream_node_members).
    """
    if task.type == "common":
        return
    if user.role == "admin":
        return

    if task.type == "pair":
        if await _is_pair_task_member(session, task.id, user.id):
            return
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this task")

    if task.type == "stream":
        if await stream_service.is_stream_member(session, task.id, user.id):
            return
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this task")

    # individual (в т.ч. перекрёстная задача внутри пары).
    if task.created_by == user.id:
        return
    assignment = await session.scalar(
        select(TaskAssignment.id).where(
            TaskAssignment.task_id == task.id,
            TaskAssignment.user_id == user.id,
        )
    )
    if assignment is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this task")


# --- пары (взаимное обучение) -----------------------------------------------


async def _is_pair_task_member(
    session: AsyncSession, task_id: int, user_id: int
) -> bool:
    """Состоит ли юзер в какой-либо (неудалённой) паре этого парного задания."""
    row = await session.scalar(
        select(TaskPairMember.id)
        .join(TaskPair, TaskPair.id == TaskPairMember.pair_id)
        .where(
            TaskPairMember.task_id == task_id,
            TaskPairMember.user_id == user_id,
            TaskPair.deleted_at.is_(None),
        )
    )
    return row is not None


async def load_pair(session: AsyncSession, pair_id: int) -> TaskPair:
    """Пара существует и не удалена, иначе 404."""
    pair = await session.get(TaskPair, pair_id)
    if pair is None or pair.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pair not found")
    return pair


async def pair_member_ids(session: AsyncSession, pair_id: int) -> list[int]:
    """user_id обоих участников пары."""
    rows = await session.execute(
        select(TaskPairMember.user_id).where(TaskPairMember.pair_id == pair_id)
    )
    return list(rows.scalars().all())


async def assert_pair_member(
    session: AsyncSession, pair: TaskPair, user: User
) -> None:
    """Юзер — участник этой пары ИЛИ админ, иначе 403."""
    if user.role == "admin":
        return
    if user.id not in await pair_member_ids(session, pair.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this pair")


async def partner_id(
    session: AsyncSession, pair: TaskPair, user_id: int
) -> int | None:
    """Второй участник пары для данного user_id (None, если сам не в паре)."""
    ids = await pair_member_ids(session, pair.id)
    others = [uid for uid in ids if uid != user_id]
    return others[0] if others else None


async def cross_task_of(
    session: AsyncSession, pair_id: int, author_id: int
) -> Task | None:
    """Перекрёстная задача, выданная данным автором в этой паре (если уже создана)."""
    task: Task | None = await session.scalar(
        select(Task).where(
            Task.pair_id == pair_id,
            Task.created_by == author_id,
            Task.deleted_at.is_(None),
        )
    )
    return task


async def recompute_pair_completion(session: AsyncSession, pair: TaskPair) -> None:
    """Пересчитать статус родительского парного задания для пары.

    Пара завершена, когда ОБЕ перекрёстные задачи (по одной от каждого участника)
    приняты (accepted). Тогда назначения родительского pair-задания у обоих
    участников переводим в 'accepted'; иначе — держим в 'assigned' (откат, если
    приёмку сняли возвратом). Достаточно одной приёмки на каждую перекрёстную —
    это отражено уже в статусе назначения перекрёстной задачи.
    """
    cross_tasks = list(
        (
            await session.execute(
                select(Task).where(
                    Task.pair_id == pair.id, Task.deleted_at.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    members = await pair_member_ids(session, pair.id)
    # Обе перекрёстные должны существовать и обе быть accepted.
    accepted_cross = 0
    for ct in cross_tasks:
        st = await session.scalar(
            select(TaskAssignment.status).where(TaskAssignment.task_id == ct.id)
        )
        if st == "accepted":
            accepted_cross += 1
    complete = len(cross_tasks) == 2 and accepted_cross == 2

    new_status = "accepted" if complete else "assigned"
    parent_assignments = list(
        (
            await session.execute(
                select(TaskAssignment).where(
                    TaskAssignment.task_id == pair.task_id,
                    TaskAssignment.user_id.in_(members),
                )
            )
        )
        .scalars()
        .all()
    )
    for a in parent_assignments:
        if a.status != new_status:
            a.status = new_status
    await session.flush()


async def get_or_create_assignment(
    session: AsyncSession, task: Task, user: User
) -> TaskAssignment:
    """Назначение юзера на задачу.

    common → создаём лениво (как ленивое членство в канале, п.3). individual →
    должно уже существовать, иначе 403 (адресатов задаёт только автор).
    """
    assignment = await session.scalar(
        select(TaskAssignment).where(
            TaskAssignment.task_id == task.id,
            TaskAssignment.user_id == user.id,
        )
    )
    if assignment is not None:
        return assignment
    if task.type != "common":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this task")

    assignment = TaskAssignment(task_id=task.id, user_id=user.id)
    session.add(assignment)
    try:
        await session.flush()
    except IntegrityError:
        # Гонка (blue/green или двойной запрос) — строка уже создана, перечитываем.
        await session.rollback()
        assignment = await session.scalar(
            select(TaskAssignment).where(
                TaskAssignment.task_id == task.id,
                TaskAssignment.user_id == user.id,
            )
        )
        assert assignment is not None
    return assignment


def deadline_soon(task: Task, now: datetime, days: int) -> bool:
    """«Горит» ли дедлайн: задан и наступает в пределах `days` (и ещё не прошёл)."""
    if task.deadline_at is None:
        return False
    return now <= task.deadline_at <= now + timedelta(days=days)


# --- синхронизация дедлайн-события календаря --------------------------------


async def _linked_event(session: AsyncSession, task_id: int) -> CalendarEvent | None:
    event: CalendarEvent | None = await session.scalar(
        select(CalendarEvent).where(CalendarEvent.task_id == task_id)
    )
    return event


async def sync_task_calendar_event(session: AsyncSession, task: Task) -> None:
    """Привести дедлайн-событие календаря в соответствие задаче.

    Дедлайн задан и задача жива → upsert события (адресность наследуется от задачи —
    room_id=None, а видимость гейтит эндпоинт календаря по task_id). Дедлайн снят или
    задача удалена → удалить связанное событие.
    """
    event = await _linked_event(session, task.id)
    should_exist = task.deadline_at is not None and task.deleted_at is None

    if not should_exist:
        if event is not None:
            await session.delete(event)
            await session.flush()
        return

    assert task.deadline_at is not None
    title = f"Дедлайн: {task.title}"
    if event is None:
        event = CalendarEvent(
            title=title,
            starts_at=task.deadline_at,
            all_day=False,
            room_id=None,
            task_id=task.id,
            created_by=task.created_by,
        )
        session.add(event)
    else:
        event.title = title
        event.starts_at = task.deadline_at
    await session.flush()


# --- фан-аут WS --------------------------------------------------------------


async def _admin_ids(session: AsyncSession) -> list[int]:
    rows = await session.execute(select(User.id).where(User.role == "admin"))
    return list(rows.scalars().all())


async def participant_count(session: AsyncSession) -> int:
    """Сколько активных участников на платформе (знаменатель прогресса общей задачи).

    Общая задача адресована каждому участнику (role='participant'), но строки
    назначений создаются лениво — поэтому «из скольки» для неё считаем по числу
    участников, а не по числу уже созданных назначений.
    """
    return (
        await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.role == "participant")
        )
    ) or 0


async def task_recipients(session: AsyncSession, task: Task) -> list[int]:
    """Кому доставлять WS-события задачи.

    common → все юзеры платформы; individual → адресаты + автор (для перекрёстной
    задачи это выдавший участник, у него нет назначения) + админы; pair → оба
    участника всех пар задания + админы; stream → все участники сетки + админы.
    """
    if task.type == "common":
        rows = await session.execute(select(User.id))
        return list(rows.scalars().all())

    if task.type == "stream":
        member_rows = await session.execute(
            select(TaskStreamNodeMember.user_id).where(
                TaskStreamNodeMember.task_id == task.id
            )
        )
        ids = set(member_rows.scalars().all())
        ids.update(await _admin_ids(session))
        return list(ids)

    if task.type == "pair":
        member_rows = await session.execute(
            select(TaskPairMember.user_id).where(TaskPairMember.task_id == task.id)
        )
        ids = set(member_rows.scalars().all())
        ids.update(await _admin_ids(session))
        return list(ids)

    assignee_rows = await session.execute(
        select(TaskAssignment.user_id).where(TaskAssignment.task_id == task.id)
    )
    ids = set(assignee_rows.scalars().all())
    ids.add(task.created_by)  # автор перекрёстной задачи (у него нет назначения)
    ids.update(await _admin_ids(session))
    return list(ids)


async def fan_out_task_event(
    session: AsyncSession, task: Task, event: dict[str, object]
) -> None:
    """Разослать событие всем получателям задачи по персональным каналам.

    publish_user_event сам глотает ошибки Redis — реалтайм не должен ронять REST.
    """
    for user_id in await task_recipients(session, task):
        await publish_user_event(user_id, event)


# --- прогресс и «требует внимания» ------------------------------------------


async def compute_progress(session: AsyncSession, user: User) -> tuple[int, int]:
    """(done, total) прогресса юзера.

    total (Y) = число общих неудалённых задач + число персональных задач юзера
    (неудалённых): individual (в т.ч. перекрёстные внутри пар) + pair (родительское
    парное задание — у юзера есть назначение) + stream (поток, назначение на каждого
    участника сетки). done (X) = сколько из них зачтено
    (назначение в статусе 'accepted'). Для общих задача в total считается всегда, а в
    done — только если юзер её сдал и она принята.
    """
    common_total = (
        await session.scalar(
            select(func.count())
            .select_from(Task)
            .where(Task.type == "common", Task.deleted_at.is_(None))
        )
    ) or 0
    individual_total = (
        await session.scalar(
            select(func.count())
            .select_from(TaskAssignment)
            .join(Task, Task.id == TaskAssignment.task_id)
            .where(
                Task.type.in_(("individual", "pair", "stream")),
                Task.deleted_at.is_(None),
                TaskAssignment.user_id == user.id,
            )
        )
    ) or 0

    done = (
        await session.scalar(
            select(func.count())
            .select_from(TaskAssignment)
            .join(Task, Task.id == TaskAssignment.task_id)
            .where(
                Task.deleted_at.is_(None),
                TaskAssignment.user_id == user.id,
                TaskAssignment.status == "accepted",
            )
        )
    ) or 0

    return done, common_total + individual_total


async def attention_count(session: AsyncSession, user: User) -> int:
    """Сколько задач требуют внимания юзера (бейдж раздела «Задачи»).

    Считаем задачи, которые ещё ждут действия юзача и НЕ приняты:
      (1) назначения юзера (common и individual) в статусах, отличных от
          'accepted' — т.е. 'assigned' / 'submitted' / 'returned'. Приём задачи
          ('accepted') уменьшает счётчик; когда всё принято — 0. Выданное
          индивидуальное задание ('assigned') сразу учитывается;
      (2) непочатые общие задачи, у которых строки назначения ещё нет (ленивое
          создание при первой сдаче) — участнику всё равно есть что сдать.
    """
    active_assignments = (
        await session.scalar(
            select(func.count())
            .select_from(TaskAssignment)
            .join(Task, Task.id == TaskAssignment.task_id)
            .where(
                Task.deleted_at.is_(None),
                TaskAssignment.user_id == user.id,
                TaskAssignment.status != "accepted",
            )
        )
    ) or 0

    interacted = select(TaskAssignment.task_id).where(
        TaskAssignment.user_id == user.id
    )
    new_common = (
        await session.scalar(
            select(func.count())
            .select_from(Task)
            .where(
                Task.type == "common",
                Task.deleted_at.is_(None),
                Task.id.not_in(interacted),
            )
        )
    ) or 0

    return active_assignments + new_common
