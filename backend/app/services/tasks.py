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
from app.models.task import Task, TaskAssignment
from app.models.user import User
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

    common → видна любому активному участнику; individual → admin ИЛИ у юзера есть
    строка task_assignments для этой задачи, иначе 403.
    """
    if task.type == "common":
        return
    if user.role == "admin":
        return
    assignment = await session.scalar(
        select(TaskAssignment.id).where(
            TaskAssignment.task_id == task.id,
            TaskAssignment.user_id == user.id,
        )
    )
    if assignment is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No access to this task")


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


async def task_recipients(session: AsyncSession, task: Task) -> list[int]:
    """Кому доставлять WS-события задачи.

    common → все юзеры платформы; individual → адресаты (user_id назначений) + админы.
    """
    if task.type == "common":
        rows = await session.execute(select(User.id))
        return list(rows.scalars().all())

    assignee_rows = await session.execute(
        select(TaskAssignment.user_id).where(TaskAssignment.task_id == task.id)
    )
    ids = set(assignee_rows.scalars().all())
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

    total (Y) = число общих неудалённых задач + число индивидуальных задач юзера
    (неудалённых). done (X) = сколько из них зачтено (у юзера есть назначение со
    статусом 'accepted'). Для общих задача в total считается всегда, а в done —
    только если юзер её сдал и она принята.
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
                Task.type == "individual",
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
