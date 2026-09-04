"""«Аргонавты» (SPEC): ростер потока + профиль участника с его задачами.

Сборочный эндпоинт в стиле dashboard.py — новой бизнес-логики нет, только
композиция уже существующих правил видимости:
  - состав ростера = участники того же intake (ARG-112 «дневники» правило: только
    поток, без рангового каскада тарифа ARG-110), минус наблюдатели (`is_observer`
    флаг) И минус держатели тарифа `OBSERVER_TARIFF_NAME` — это ДВЕ независимые
    группы (флаг ставится за 5 пропусков, тариф покупается с самого начала), обе
    исключены из ростера целиком; админы в ростере ЕСТЬ (отдельная секция на
    фронте), но без карточки задач — у них их нет по построению;
  - фронт группирует плитки по тарифу (Игрок/Спецотряд/Око — см. lib/planGroups
    `contactPlanKey`/`groupPreOrdered`), поэтому сортируем так же, как
    `list_contacts` (ARG-110): участники по рангу тарифа, админы хвостовым блоком;
  - `tasks_done`/`tasks` считаются по common-задачам, видимым СМОТРЯЩЕМУ
    (`_visible_common_where`, тот же двойной фильтр поток+тариф, что и в
    разделе «Задачи») — individual/pair/stream задачи чужому участнику не
    показываем, это личные назначения;
  - «выполнено» = `status == 'accepted'`; в карточке участника дополнительно
    видны `submitted` (сдано, на проверке) — `returned` не показываем, это не
    «сдано»;
  - `expedition_feat` — отдельное поле «Подвиг на Экспедицию»: текст ПОСЛЕДНЕЙ
    сдачи (любой статус) именованной задачи `EXPEDITION_FEAT_TASK_TITLE`. На
    проде эта задача — `type='individual'` (персональное задание каждому
    участнику потока), НЕ `common` — значит `_visible_common_where` тут не
    применяется (она фильтрует по `Task.type == 'common'` и всегда давала бы
    404-подобный «нет такой задачи»); видимость этого поля обеспечена тем, что
    `user` уже прошёл через `_roster` (тот же поток). Матчинг по точному
    заголовку задачи, а не по флагу в БД — переименование задачи на проде молча
    отключит поле, см. docs/ARGONAUTS.md. Заодно отдаём `expedition_feat_task_id`/
    `_status` — фронт даёт владельцу профиля отредактировать через тот же
    `POST /api/tasks/{id}/submissions`, что и обычный раздел «Задачи» (никакого
    нового write-эндпоинта здесь нет — эта задача только читает).
Наблюдателю раздел закрыт целиком (`require_participant`), как Задачи/Рубка.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_participant
from app.db.session import get_session
from app.models.plan import Plan
from app.models.room import Room
from app.models.task import Task, TaskAssignment, TaskSubmission
from app.models.user import User
from app.schemas.argonaut import ArgonautDetailOut, ArgonautOut, ArgonautTaskOut
from app.services.media import presign_asset_urls
from app.services.tasks import _visible_common_where
from app.services.users import avatar_url, plan_names
from app.services.visibility import CHEAP_TARIFF_NAME, cohort_plan_ranks, user_rank

router = APIRouter(
    prefix="/api/argonauts",
    tags=["argonauts"],
    dependencies=[Depends(require_participant)],
)

# «Сдано» с точки зрения ростера — принято ИЛИ ждёт проверки. 'returned'/'assigned'
# не показываем: возврат ещё не закрыт, а невзятая задача — не «его» карточка.
VISIBLE_TASK_STATUSES = ("accepted", "submitted")

# Точное название задачи, чья последняя сдача показывается полем «Подвиг на
# Экспедицию» (см. docstring модуля). Единственный на платформе матчинг
# бизнес-контента по заголовку — задача не размечена флагом в БД.
EXPEDITION_FEAT_TASK_TITLE = "Освобождаем оперативку"

# Держатели этого тарифа исключены из ростера, как и is_observer (см. docstring
# модуля). Тот же тариф — см. `app/services/visibility.py`.
OBSERVER_TARIFF_NAME = CHEAP_TARIFF_NAME


async def _roster(session: AsyncSession, current_user: User) -> list[User]:
    """Состав + порядок (участники по рангу тарифа, админы хвостом) — фронт режет
    на секции по соседним элементам, ранги сам не пересчитывает (см. модуль)."""
    if current_user.intake_id is None:
        return []
    observer_plan_ids = select(Plan.id).where(Plan.name == OBSERVER_TARIFF_NAME)
    rows = await session.execute(
        select(User).where(
            User.intake_id == current_user.intake_id,
            User.is_observer.is_(False),
            User.id != current_user.id,
            # Без тарифа (plan_id IS NULL) НЕ считается держателем тарифа
            # «Наблюдатель» — NOT IN с NULL слева не отфильтровал бы иначе
            # (SQL three-valued logic), поэтому explicit OR.
            or_(User.plan_id.is_(None), User.plan_id.not_in(observer_plan_ids)),
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


async def _expedition_feat(
    session: AsyncSession, current_user: User, user_id: int
) -> tuple[int | None, str | None, str | None]:
    """(task_id, текст последней сдачи, статус назначения) для задачи
    EXPEDITION_FEAT_TASK_TITLE. task_id/status отдаются фронту, чтобы владелец
    профиля мог сдать/отредактировать через уже существующий TaskComposer
    (`POST /api/tasks/{task_id}/submissions`) — эта функция только читает.

    На проде это `type='individual'` задание (персональное каждому участнику,
    НЕ common) — `_visible_common_where` тут не применяется, она бы требовала
    `Task.type == 'common'` и всегда возвращала бы «нет такой задачи» (см.
    docstring модуля). Видимость обеспечена тем, что `user` уже прошёл через
    `_roster` (тот же поток, что и у current_user); `intake_id` задачи —
    необязательная метка provisioning, сверяем её только чтобы не подцепить
    одноимённую задачу ДРУГОГО потока, если такая когда-нибудь появится.

    `task_id` возвращаем `None`, если у `user_id` нет строки `task_assignments` —
    иначе фронт на СВОЕЙ странице показал бы TaskComposer, чей submit гарантированно
    словит 403 (`assert_task_visible` для individual требует своё назначение либо
    авторство задачи, см. services/tasks.py) — молча отправлять в тупик не стоит.
    """
    task_id = await session.scalar(
        select(Task.id)
        .where(
            Task.title == EXPEDITION_FEAT_TASK_TITLE,
            Task.deleted_at.is_(None),
            or_(Task.intake_id.is_(None), Task.intake_id == current_user.intake_id),
        )
        .limit(1)
    )
    if task_id is None:
        return None, None, None
    # LEFT JOIN: назначение может существовать без единой сдачи (status='assigned')
    # — статус фронту нужен и в этом случае (чтобы сразу открыть композер), body
    # тогда NULL. Нет строки вовсе — юзер на это задание не назначен.
    row = (
        await session.execute(
            select(TaskAssignment.status, TaskSubmission.body)
            .select_from(TaskAssignment)
            .outerjoin(TaskSubmission, TaskSubmission.assignment_id == TaskAssignment.id)
            .where(TaskAssignment.task_id == task_id, TaskAssignment.user_id == user_id)
            .order_by(TaskSubmission.created_at.desc().nullslast())
            .limit(1)
        )
    ).first()
    if row is None:
        return None, None, None
    status, body = row
    return task_id, body, status


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
    feat_task_id, expedition_feat, feat_status = await _expedition_feat(
        session, current_user, user.id
    )

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
        expedition_feat=expedition_feat,
        expedition_feat_task_id=feat_task_id,
        expedition_feat_status=feat_status,
    )
