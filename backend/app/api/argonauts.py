"""«Аргонавты» (SPEC): ростер потока + профиль участника с его задачами.

Сборочный эндпоинт в стиле dashboard.py — новой бизнес-логики нет, только
композиция уже существующих правил видимости:
  - состав ростера = участники того же intake (ARG-112 «дневники» правило: только
    поток, без рангового каскада тарифа ARG-110), минус наблюдатели; админы в
    ростере ЕСТЬ (отдельная секция на фронте), но без карточки задач — у них их
    нет по построению;
  - фронт группирует плитки по тарифу (Игрок/Спецотряд/Око — см. lib/planGroups
    `contactPlanKey`/`groupPreOrdered`), поэтому сортируем так же, как
    `list_contacts` (ARG-110): участники по рангу тарифа, админы хвостовым блоком;
  - `tasks_done`/`tasks` считаются по common-задачам, видимым СМОТРЯЩЕМУ
    (`_visible_common_where`, тот же двойной фильтр поток+тариф, что и в
    разделе «Задачи») — individual/pair/stream задачи чужому участнику не
    показываем, это личные назначения;
  - «выполнено» = `status == 'accepted'`; в карточке участника дополнительно
    видны `submitted` (сдано, на проверке) — `returned` не показываем, это не
    «сдано».
Наблюдателю раздел закрыт целиком (`require_participant`), как Задачи/Рубка.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_participant
from app.db.session import get_session
from app.models.room import Room
from app.models.task import Task, TaskAssignment
from app.models.user import User
from app.schemas.argonaut import ArgonautDetailOut, ArgonautOut, ArgonautTaskOut
from app.services.media import presign_asset_urls
from app.services.tasks import _visible_common_where
from app.services.users import avatar_url, plan_names
from app.services.visibility import cohort_plan_ranks, user_rank

router = APIRouter(
    prefix="/api/argonauts",
    tags=["argonauts"],
    dependencies=[Depends(require_participant)],
)

# «Сдано» с точки зрения ростера — принято ИЛИ ждёт проверки. 'returned'/'assigned'
# не показываем: возврат ещё не закрыт, а невзятая задача — не «его» карточка.
VISIBLE_TASK_STATUSES = ("accepted", "submitted")


async def _roster(session: AsyncSession, current_user: User) -> list[User]:
    """Состав + порядок (участники по рангу тарифа, админы хвостом) — фронт режет
    на секции по соседним элементам, ранги сам не пересчитывает (см. модуль)."""
    if current_user.intake_id is None:
        return []
    rows = await session.execute(
        select(User).where(
            User.intake_id == current_user.intake_id,
            User.is_observer.is_(False),
            User.id != current_user.id,
        )
    )
    users = list(rows.scalars().all())
    ranks = await cohort_plan_ranks(session, current_user.intake_id)
    users.sort(key=lambda u: (u.role == "admin", user_rank(u, ranks), u.display_name))
    return users


async def _tasks_done_by_user(
    session: AsyncSession, current_user: User, user_ids: list[int]
) -> dict[int, int]:
    """user_id -> число принятых common-задач, видимых current_user."""
    if not user_ids:
        return {}
    rows = await session.execute(
        select(TaskAssignment.user_id, func.count())
        .select_from(TaskAssignment)
        .join(Task, Task.id == TaskAssignment.task_id)
        .where(
            *_visible_common_where(current_user),
            Task.deleted_at.is_(None),
            TaskAssignment.user_id.in_(user_ids),
            TaskAssignment.status == "accepted",
        )
        .group_by(TaskAssignment.user_id)
    )
    return dict(rows.tuples().all())


async def _diary_room_ids(session: AsyncSession, user_ids: list[int]) -> dict[int, int]:
    """created_by -> id личного дневника (см. `_personal_room_id` в api/dynamics.py)."""
    if not user_ids:
        return {}
    rows = await session.execute(
        select(Room.created_by, Room.id).where(
            Room.is_personal.is_(True), Room.created_by.in_(user_ids)
        )
    )
    return dict(rows.tuples().all())


@router.get("", response_model=list[ArgonautOut])
async def list_argonauts(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ArgonautOut]:
    users = await _roster(session, current_user)
    media_ids = {u.avatar_media_id for u in users if u.avatar_media_id is not None}
    signed = await presign_asset_urls(session, media_ids)
    plans = await plan_names(session, users)
    done = await _tasks_done_by_user(session, current_user, [u.id for u in users])
    return [
        ArgonautOut(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            avatar_url=avatar_url(u, signed),
            role=u.role,
            plan_id=u.plan_id,
            plan_name=plans.get(u.plan_id) if u.plan_id is not None else None,
            tasks_done=done.get(u.id, 0),
        )
        for u in users
    ]


@router.get("/{user_id}", response_model=ArgonautDetailOut)
async def get_argonaut(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ArgonautDetailOut:
    # 404 (не 403): не подтверждаем клиенту существование юзера вне его потока.
    roster = await _roster(session, current_user)
    user = next((u for u in roster if u.id == user_id), None)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Argonaut not found")

    media_ids = {user.avatar_media_id} if user.avatar_media_id is not None else set()
    signed = await presign_asset_urls(session, media_ids)
    plans = await plan_names(session, [user])
    # Личный канал админа не проходит diary_visible (owner.role != 'admin') —
    # ссылка вела бы на 403, поэтому для админов её не отдаём вовсе.
    diary_rooms = await _diary_room_ids(session, [user.id]) if user.role != "admin" else {}

    rows = await session.execute(
        select(
            Task.id,
            Task.title,
            TaskAssignment.status,
            Task.deadline_at,
            TaskAssignment.reviewed_at,
        )
        .select_from(TaskAssignment)
        .join(Task, Task.id == TaskAssignment.task_id)
        .where(
            *_visible_common_where(current_user),
            Task.deleted_at.is_(None),
            TaskAssignment.user_id == user.id,
            TaskAssignment.status.in_(VISIBLE_TASK_STATUSES),
        )
        .order_by(TaskAssignment.reviewed_at.desc().nullslast(), TaskAssignment.created_at.desc())
    )
    tasks = [
        ArgonautTaskOut(
            task_id=task_id,
            title=title,
            status=task_status,
            deadline_at=deadline_at,
            reviewed_at=reviewed_at,
        )
        for task_id, title, task_status, deadline_at, reviewed_at in rows.all()
    ]
    tasks_done = sum(1 for t in tasks if t.status == "accepted")

    return ArgonautDetailOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=avatar_url(user, signed),
        bio=user.bio,
        role=user.role,
        plan_id=user.plan_id,
        plan_name=plans.get(user.plan_id) if user.plan_id is not None else None,
        tasks_done=tasks_done,
        diary_room_id=diary_rooms.get(user.id),
        tasks=tasks,
    )
