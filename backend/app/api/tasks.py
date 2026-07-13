"""Задачи (SPEC: раздел «Задачи»): CRUD задач (admin), сдачи, ревью, комментарии.

Задача общая (`common`, видна всем активным участникам) или индивидуальная
(`individual`, адресована конкретным юзерам). Авторизация на КАЖДОМ запросе
(CLAUDE.md п.1, анти-IDOR): видимость задачи/сдачи проверяется на сервере, id от
клиента не доверяем. Мягкое удаление (п.6). Дедлайн синхронизируется с календарём.
Реалтайм — персональный канал user:{id} (publish_user_event), фан-аут по получателям.

Порядок маршрутов важен: литеральные префиксы (`/assignments/...`, `/submissions/...`,
`/comments/...`) объявлены ДО `/{task_id}`, иначе FastAPI перехватил бы их как task_id.
"""
import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import ColumnElement, func, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin
from app.core.config import settings
from app.db.session import get_session
from app.models.kb import KbItem
from app.models.media import MediaAsset
from app.models.task import (
    Task,
    TaskAssignment,
    TaskComment,
    TaskMedia,
    TaskPair,
    TaskPairMember,
    TaskSubmission,
    TaskSubmissionMedia,
)
from app.models.user import User
from app.schemas.task import (
    AdminAssignmentOut,
    CrossTaskCreate,
    CrossTaskUpdate,
    MeetingUpdate,
    PairMemberOut,
    PairOut,
    ProgressOut,
    ReviewRequest,
    SubmissionCreate,
    SubmissionOut,
    TaskCommentCreate,
    TaskCommentOut,
    TaskCreate,
    TaskListOut,
    TaskOut,
    TaskTrackOut,
    TaskUpdate,
    TaskWithStatusOut,
)
from app.services.media import (
    resolve_submission_attachments,
    resolve_task_attachments,
)
from app.services.ratelimit import enforce_rate_limit
from app.services.tasks import (
    assert_pair_member,
    assert_task_visible,
    attention_count,
    compute_progress,
    cross_task_of,
    deadline_soon,
    fan_out_task_event,
    get_or_create_assignment,
    load_pair,
    load_task,
    pair_member_ids,
    participant_count,
    partner_id,
    recompute_pair_completion,
    sync_task_calendar_event,
)
from app.ws import schemas as ws_schemas

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# Поля, которые admin вправе править через PATCH.
_PATCHABLE_FIELDS = {"title", "body", "deadline_at", "kb_item_id"}


async def _assert_kb_item_exists(session: AsyncSession, kb_item_id: int | None) -> None:
    if kb_item_id is None:
        return
    if await session.get(KbItem, kb_item_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KB item not found")


async def _assert_users_exist(session: AsyncSession, user_ids: list[int]) -> None:
    """Все переданные user_id должны существовать, иначе 422."""
    if not user_ids:
        return
    found = await session.execute(
        select(User.id).where(User.id.in_(user_ids))
    )
    if set(found.scalars().all()) != set(user_ids):
        # 422 как у pydantic-валидации (константа Starlette переименована).
        raise HTTPException(422, "Assignee not found")


# --- admin CRUD ------------------------------------------------------------


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    body: TaskCreate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskOut:
    """Создать задачу. individual требует ≥1 существующего адресата (иначе 422).

    Для individual создаём строки назначений сразу; для common — лениво при сдаче.
    Дедлайн (если задан) синхронизируется с событием календаря. Фан-аут task.created.
    """
    await _assert_kb_item_exists(session, body.kb_item_id)

    pairs_input: list[list[int]] = []
    if body.type == "individual":
        assignee_ids = list(dict.fromkeys(body.assignee_ids))
        if not assignee_ids:
            raise HTTPException(
                422, "Individual task requires at least one assignee"
            )
        await _assert_users_exist(session, assignee_ids)
    elif body.type == "pair":
        if not body.pairs:
            raise HTTPException(422, "Pair task requires at least one pair")
        pairs_input = [p.user_ids for p in body.pairs]
        flat = [uid for pair in pairs_input for uid in pair]
        if len(set(flat)) != len(flat):
            # Один человек — максимум в одной паре задания (см. uq_task_pair_member).
            raise HTTPException(422, "A user may appear in only one pair")
        await _assert_users_exist(session, flat)
        assignee_ids = []
    else:
        assignee_ids = []

    task = Task(
        type=body.type,
        title=body.title,
        body=body.body,
        kb_item_id=body.kb_item_id,
        deadline_at=body.deadline_at,
        created_by=current_admin.id,
    )
    session.add(task)
    await session.flush()

    for uid in assignee_ids:
        session.add(TaskAssignment(task_id=task.id, user_id=uid))

    # Пары: task_pairs + members (случайный организатор встречи) + назначение
    # родительского pair-задания каждому участнику (для статуса «выполнено/нет»).
    for user_ids in pairs_input:
        organizer_id = secrets.choice(user_ids)
        pair = TaskPair(
            task_id=task.id, meeting_organizer_id=organizer_id
        )
        session.add(pair)
        await session.flush()
        for uid in user_ids:
            session.add(
                TaskPairMember(pair_id=pair.id, task_id=task.id, user_id=uid)
            )
            session.add(TaskAssignment(task_id=task.id, user_id=uid))

    media_ids = list(dict.fromkeys(body.media_asset_ids))
    if media_ids:
        found = await session.execute(
            select(MediaAsset.id).where(
                MediaAsset.id.in_(media_ids),
                MediaAsset.created_by == current_admin.id,
            )
        )
        if set(found.scalars().all()) != set(media_ids):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")
        for asset_id in media_ids:
            session.add(TaskMedia(task_id=task.id, media_asset_id=asset_id))

    await session.flush()

    if task.deadline_at is not None:
        await sync_task_calendar_event(session, task)

    await session.refresh(task)
    await fan_out_task_event(
        session, task, ws_schemas.task_created_event(task.id, task.type, task.title)
    )
    attachments = (await resolve_task_attachments(session, [task.id])).get(task.id, [])
    return TaskOut(
        id=task.id,
        type=task.type,
        title=task.title,
        body=task.body,
        kb_item_id=task.kb_item_id,
        pair_id=task.pair_id,
        deadline_at=task.deadline_at,
        created_by=task.created_by,
        created_at=task.created_at,
        attachments=attachments,
    )


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: int,
    body: TaskUpdate,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskOut:
    """Частичное обновление whitelisted-полей. Ресинк календаря, фан-аут task.updated."""
    task = await load_task(session, task_id)

    changes = body.model_dump(exclude_unset=True)
    if "kb_item_id" in changes:
        await _assert_kb_item_exists(session, changes["kb_item_id"])
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(task, field, value)

    # media_asset_ids: None — не трогаем; список — заменяем весь набор целиком.
    if "media_asset_ids" in changes and changes["media_asset_ids"] is not None:
        new_ids = list(dict.fromkeys(changes["media_asset_ids"]))
        await session.execute(sa_delete(TaskMedia).where(TaskMedia.task_id == task.id))
        if new_ids:
            found = await session.execute(
                select(MediaAsset.id).where(
                    MediaAsset.id.in_(new_ids),
                    MediaAsset.created_by == current_admin.id,
                )
            )
            if set(found.scalars().all()) != set(new_ids):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")
            for asset_id in new_ids:
                session.add(TaskMedia(task_id=task.id, media_asset_id=asset_id))

    await session.flush()

    await sync_task_calendar_event(session, task)
    await session.refresh(task)
    await fan_out_task_event(session, task, ws_schemas.task_updated_event(task.id))
    attachments = (await resolve_task_attachments(session, [task.id])).get(task.id, [])
    return TaskOut(
        id=task.id,
        type=task.type,
        title=task.title,
        body=task.body,
        kb_item_id=task.kb_item_id,
        pair_id=task.pair_id,
        deadline_at=task.deadline_at,
        created_by=task.created_by,
        created_at=task.created_at,
        attachments=attachments,
    )


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Мягко удалить задачу (deleted_at, п.6) и снять её дедлайн-событие календаря."""
    task = await load_task(session, task_id)
    task.deleted_at = datetime.now(UTC)
    await session.flush()
    await sync_task_calendar_event(session, task)  # deleted → удалит событие
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- ревью / комментарии / сдачи по литеральным префиксам ------------------
# (объявлены ДО /{task_id}, чтобы не быть перехваченными как task_id)


@router.post("/assignments/{assignment_id}/review", response_model=TaskTrackOut)
async def review_assignment(
    assignment_id: int,
    body: ReviewRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskTrackOut:
    """Ревью сдачи. accept → 'accepted'; return → 'returned' + комментарий на
    последнюю сдачу (обязателен). Оба ставят reviewed_at. Фан-аут статуса адресату.

    Право ревью: админ — всегда; плюс автор перекрёстной задачи (участник, выдавший
    задачу партнёру внутри пары) — по своей задаче. Приёмка/возврат перекрёстной
    задачи пересчитывает завершённость её пары.
    """
    assignment = await session.get(TaskAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    task = await load_task(session, assignment.task_id)

    # Авторизация: админ ИЛИ автор перекрёстной задачи (task.created_by внутри пары).
    is_cross_author = task.pair_id is not None and task.created_by == current_user.id
    if current_user.role != "admin" and not is_cross_author:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to review")

    if body.action == "accept":
        assignment.status = "accepted"
    else:
        # return: комментарий на последнюю сдачу этого назначения.
        latest = await session.scalar(
            select(TaskSubmission)
            .where(TaskSubmission.assignment_id == assignment_id)
            .order_by(TaskSubmission.id.desc())
            .limit(1)
        )
        if latest is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Nothing to return: no submission yet"
            )
        assert body.comment is not None
        session.add(
            TaskComment(
                submission_id=latest.id,
                author_id=current_user.id,
                body=body.comment,
            )
        )
        assignment.status = "returned"
    assignment.reviewed_at = datetime.now(UTC)
    await session.flush()

    # Перекрёстная задача → пересчитать завершённость её пары (закрыть/откатить
    # родительское pair-задание обоих участников).
    if task.pair_id is not None:
        pair = await load_pair(session, task.pair_id)
        await recompute_pair_completion(session, pair)

    # Статус — адресату назначения (персональный канал).
    from app.ws.pubsub import publish_user_event

    await publish_user_event(
        assignment.user_id,
        ws_schemas.task_submission_status_event(
            task.id, assignment.id, assignment.status
        ),
    )
    return await _track_out(session, assignment)


@router.get(
    "/submissions/{submission_id}/comments", response_model=list[TaskCommentOut]
)
async def list_submission_comments(
    submission_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TaskComment]:
    """Комментарии под сдачей (без удалённых), по возрастанию. Видимость = видимость задачи."""
    await _load_visible_submission(session, submission_id, current_user)
    rows = await session.execute(
        select(TaskComment)
        .where(
            TaskComment.submission_id == submission_id,
            TaskComment.deleted_at.is_(None),
        )
        .order_by(TaskComment.created_at, TaskComment.id)
    )
    return list(rows.scalars().all())


@router.post(
    "/submissions/{submission_id}/comments",
    response_model=TaskCommentOut,
    status_code=201,
)
async def create_submission_comment(
    submission_id: int,
    body: TaskCommentCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskComment:
    """Комментарий под сдачей. Право = видимость задачи (individual — адресат/админ)."""
    await enforce_rate_limit(
        f"rl:send:{current_user.id}", settings.rate_limit_send_per_minute
    )
    _, task = await _load_visible_submission(session, submission_id, current_user)

    comment = TaskComment(
        submission_id=submission_id,
        author_id=current_user.id,
        body=body.body,
    )
    session.add(comment)
    await session.flush()
    await session.refresh(comment)

    await fan_out_task_event(
        session,
        task,
        ws_schemas.task_comment_new_event(task.id, submission_id, comment.id),
    )
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Мягко удалить комментарий: автор или admin (п.6). 404, если нет/уже удалён."""
    comment = await session.get(TaskComment, comment_id)
    if comment is None or comment.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Comment not found")
    if comment.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed")

    comment.deleted_at = datetime.now(UTC)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- пары (взаимное обучение) ----------------------------------------------
# (литеральный префикс /pairs/... объявлен ДО /{task_id})


async def _link_task_media(
    session: AsyncSession, task_id: int, media_ids: list[int], owner_id: int
) -> None:
    """Привязать медиа-ассеты (владелец owner_id) к задаче как медиа условия.

    Ассеты должны существовать и принадлежать owner_id (иначе 404 — анти-IDOR).
    Полностью заменяет набор TaskMedia у задачи.
    """
    ids = list(dict.fromkeys(media_ids))
    await session.execute(sa_delete(TaskMedia).where(TaskMedia.task_id == task_id))
    if not ids:
        return
    found = await session.execute(
        select(MediaAsset.id).where(
            MediaAsset.id.in_(ids), MediaAsset.created_by == owner_id
        )
    )
    if set(found.scalars().all()) != set(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")
    for asset_id in ids:
        session.add(TaskMedia(task_id=task_id, media_asset_id=asset_id))


async def _build_pair_out(
    session: AsyncSession, pair: TaskPair, viewer: User
) -> PairOut:
    """Собрать PairOut: участники, их перекрёстные задачи, встреча, права смотрящего."""
    member_ids = await pair_member_ids(session, pair.id)
    members: list[PairMemberOut] = []
    for uid in member_ids:
        ct = await cross_task_of(session, pair.id, uid)
        members.append(
            PairMemberOut(
                user_id=uid,
                is_meeting_organizer=(uid == pair.meeting_organizer_id),
                cross_task_id=ct.id if ct else None,
            )
        )
    viewer_uid = viewer.id if viewer.id in member_ids else None
    return PairOut(
        pair_id=pair.id,
        members=members,
        meeting_at=pair.meeting_at,
        viewer_user_id=viewer_uid,
        can_manage_meeting=(viewer.id == pair.meeting_organizer_id),
    )


async def _visible_pairs_for(
    session: AsyncSession, task: Task, viewer: User
) -> list[PairOut] | None:
    """Пары парного задания, видимые смотрящему: участник — только свою; админ — все.
    None для обычных (не pair) задач."""
    if task.type != "pair":
        return None
    stmt = select(TaskPair).where(
        TaskPair.task_id == task.id, TaskPair.deleted_at.is_(None)
    )
    if viewer.role != "admin":
        my_pair_ids = select(TaskPairMember.pair_id).where(
            TaskPairMember.task_id == task.id, TaskPairMember.user_id == viewer.id
        )
        stmt = stmt.where(TaskPair.id.in_(my_pair_ids))
    pairs = list((await session.execute(stmt.order_by(TaskPair.id))).scalars().all())
    return [await _build_pair_out(session, p, viewer) for p in pairs]


@router.patch("/{task_id}/pairs/{pair_id}", status_code=204)
async def replace_pair_member(
    task_id: int,
    pair_id: int,
    body: dict[str, int],
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Заменить участника пары: `{old_user_id, new_user_id}`. Разрешено ТОЛЬКО пока
    внутри пары ещё ничего не выдано (нет перекрёстных задач), иначе 409.
    """
    task = await load_task(session, task_id)
    pair = await load_pair(session, pair_id)
    if pair.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pair not found")

    old_id = body.get("old_user_id")
    new_id = body.get("new_user_id")
    if old_id is None or new_id is None:
        raise HTTPException(422, "old_user_id and new_user_id are required")

    # Внутри пары уже что-то выдано? Тогда замена запрещена.
    existing_cross = await session.scalar(
        select(func.count())
        .select_from(Task)
        .where(Task.pair_id == pair.id, Task.deleted_at.is_(None))
    )
    if existing_cross:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Cannot replace: tasks already exchanged"
        )

    member = await session.scalar(
        select(TaskPairMember).where(
            TaskPairMember.pair_id == pair.id, TaskPairMember.user_id == old_id
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pair member not found")
    await _assert_users_exist(session, [new_id])
    # new_id не должен уже быть в паре этого задания (UNIQUE поймает, но дадим 409).
    clash = await session.scalar(
        select(TaskPairMember.id).where(
            TaskPairMember.task_id == task.id, TaskPairMember.user_id == new_id
        )
    )
    if clash is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "User already in a pair")

    member.user_id = new_id
    if pair.meeting_organizer_id == old_id:
        pair.meeting_organizer_id = new_id
    # Перекинуть назначение родительского pair-задания на нового участника.
    old_assignment = await session.scalar(
        select(TaskAssignment).where(
            TaskAssignment.task_id == task.id, TaskAssignment.user_id == old_id
        )
    )
    if old_assignment is not None:
        old_assignment.user_id = new_id
    await session.flush()
    await fan_out_task_event(session, task, ws_schemas.task_updated_event(task.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{task_id}/pairs/{pair_id}", status_code=204)
async def delete_pair(
    task_id: int,
    pair_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Расформировать пару (мягко). Скрывает перекрёстные задачи пары и снимает их
    дедлайн-события; родительские назначения обоих участников удаляются. Скрытое
    админское действие.
    """
    task = await load_task(session, task_id)
    pair = await load_pair(session, pair_id)
    if pair.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pair not found")

    member_ids = await pair_member_ids(session, pair.id)
    now = datetime.now(UTC)
    pair.deleted_at = now

    # Мягко удалить перекрёстные задачи пары + снять их дедлайн-события.
    cross_tasks = list(
        (
            await session.execute(
                select(Task).where(Task.pair_id == pair.id, Task.deleted_at.is_(None))
            )
        )
        .scalars()
        .all()
    )
    for ct in cross_tasks:
        ct.deleted_at = now
        await sync_task_calendar_event(session, ct)

    # Родительские назначения участников этой пары больше не нужны.
    await session.execute(
        sa_delete(TaskAssignment).where(
            TaskAssignment.task_id == task.id,
            TaskAssignment.user_id.in_(member_ids),
        )
    )
    await session.flush()
    await fan_out_task_event(session, task, ws_schemas.task_updated_event(task.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{task_id}/pairs/{pair_id}/meeting", status_code=204)
async def update_meeting(
    task_id: int,
    pair_id: int,
    body: MeetingUpdate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Назначить/перенести/отменить встречу пары. Только организатор встречи (иначе
    403). Информационное поле — уведомления не шлём (люди общаются вне системы).
    """
    task = await load_task(session, task_id)
    pair = await load_pair(session, pair_id)
    if pair.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pair not found")
    if current_user.role != "admin" and current_user.id != pair.meeting_organizer_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the meeting organizer may manage it"
        )
    pair.meeting_at = body.meeting_at
    await session.flush()
    await fan_out_task_event(session, task, ws_schemas.task_updated_event(task.id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{task_id}/pairs/{pair_id}/cross-task", response_model=TaskOut, status_code=201
)
async def create_cross_task(
    task_id: int,
    pair_id: int,
    body: CrossTaskCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskOut:
    """Выдать задачу партнёру. Получатель предопределён (второй участник пары).
    Ровно одна на выдающего (повтор → 409). Создаёт individual-задачу (автор —
    участник) с назначением на партнёра и связью pair_id.
    """
    task = await load_task(session, task_id)
    pair = await load_pair(session, pair_id)
    if pair.task_id != task.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pair not found")
    await assert_pair_member(session, pair, current_user)

    recipient_id = await partner_id(session, pair, current_user.id)
    if recipient_id is None:
        # Админ-неучастник не может выдавать задачу за участника.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this pair")

    if await cross_task_of(session, pair.id, current_user.id) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Task already given")

    cross = Task(
        type="individual",
        title=body.title,
        body=body.body,
        deadline_at=body.deadline_at,
        created_by=current_user.id,
        pair_id=pair.id,
    )
    session.add(cross)
    await session.flush()
    session.add(TaskAssignment(task_id=cross.id, user_id=recipient_id))
    await _link_task_media(session, cross.id, body.media_asset_ids, current_user.id)
    await session.flush()

    if cross.deadline_at is not None:
        await sync_task_calendar_event(session, cross)
    await session.refresh(cross)
    await fan_out_task_event(
        session, cross, ws_schemas.task_created_event(cross.id, cross.type, cross.title)
    )
    attachments = (await resolve_task_attachments(session, [cross.id])).get(cross.id, [])
    return TaskOut(
        id=cross.id,
        type=cross.type,
        title=cross.title,
        body=cross.body,
        kb_item_id=cross.kb_item_id,
        pair_id=cross.pair_id,
        deadline_at=cross.deadline_at,
        created_by=cross.created_by,
        created_at=cross.created_at,
        attachments=attachments,
    )


@router.patch(
    "/{task_id}/pairs/{pair_id}/cross-task/{cross_task_id}", response_model=TaskOut
)
async def update_cross_task(
    task_id: int,
    pair_id: int,
    cross_task_id: int,
    body: CrossTaskUpdate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskOut:
    """Править выданную перекрёстную задачу — только её автор и только пока нет сдач
    (иначе 409). Дедлайн ресинкается с календарём.
    """
    pair = await load_pair(session, pair_id)
    cross = await load_task(session, cross_task_id)
    if cross.pair_id != pair.id or pair.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    if cross.created_by != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the author may edit")

    # Есть ли уже сдачи? Тогда правка запрещена.
    has_submission = await session.scalar(
        select(func.count())
        .select_from(TaskSubmission)
        .join(TaskAssignment, TaskAssignment.id == TaskSubmission.assignment_id)
        .where(TaskAssignment.task_id == cross.id)
    )
    if has_submission:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Cannot edit: submission already exists"
        )

    changes = body.model_dump(exclude_unset=True)
    for field in ("title", "body", "deadline_at"):
        if field in changes:
            setattr(cross, field, changes[field])
    if "media_asset_ids" in changes and changes["media_asset_ids"] is not None:
        await _link_task_media(
            session, cross.id, changes["media_asset_ids"], current_user.id
        )
    await session.flush()
    await sync_task_calendar_event(session, cross)
    await session.refresh(cross)
    await fan_out_task_event(session, cross, ws_schemas.task_updated_event(cross.id))
    attachments = (await resolve_task_attachments(session, [cross.id])).get(cross.id, [])
    return TaskOut(
        id=cross.id,
        type=cross.type,
        title=cross.title,
        body=cross.body,
        kb_item_id=cross.kb_item_id,
        pair_id=cross.pair_id,
        deadline_at=cross.deadline_at,
        created_by=cross.created_by,
        created_at=cross.created_at,
        attachments=attachments,
    )


# --- список / деталь / сдачи задачи ----------------------------------------


@router.get("", response_model=TaskListOut)
async def list_tasks(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskListOut:
    """Задачи, видимые юзеру: все общие + свои индивидуальные (неудалённые).

    Каждая обогащена состоянием юзера (my_status/late/deadline_soon) и агрегатами
    (assignee_count для individual, submitted_count, accepted_count). Порядок:
    сначала с дедлайном (по возрастанию), затем без дедлайна — по created_at desc.
    Плюс прогресс X/Y и счётчик «требует внимания».
    """
    now = datetime.now(UTC)
    days = settings.task_deadline_soon_days

    # Видимые задачи: админ видит ВСЕ неудалённые (он модератор и автор — иначе
    # созданная им individual-задача, где он не адресат, выпала бы из его списка).
    # Участник: common ∪ (individual, где у него есть назначение).
    where: list[ColumnElement[bool]] = [Task.deleted_at.is_(None)]
    if current_user.role != "admin":
        my_individual = select(TaskAssignment.task_id).where(
            TaskAssignment.user_id == current_user.id
        )
        where.append((Task.type == "common") | (Task.id.in_(my_individual)))
    stmt = (
        select(Task)
        .where(*where)
        .order_by(
            Task.deadline_at.is_(None),  # False (есть дедлайн) — раньше
            Task.deadline_at.asc(),
            Task.created_at.desc(),
        )
    )
    tasks = list((await session.execute(stmt)).scalars().all())
    task_ids = [t.id for t in tasks]

    # Назначения текущего юзера по видимым задачам (my_status/late).
    my_assignments: dict[int, TaskAssignment] = {}
    if task_ids:
        rows = await session.execute(
            select(TaskAssignment).where(
                TaskAssignment.task_id.in_(task_ids),
                TaskAssignment.user_id == current_user.id,
            )
        )
        my_assignments = {a.task_id: a for a in rows.scalars().all()}

    # Агрегаты по назначениям задачи (кол-во адресатов, сдано, принято, на проверке).
    assignee_counts: dict[int, int] = {}
    submitted_counts: dict[int, int] = {}
    accepted_counts: dict[int, int] = {}
    unreviewed_counts: dict[int, int] = {}
    if task_ids:
        agg = await session.execute(
            select(
                TaskAssignment.task_id,
                func.count(),
                func.count().filter(
                    TaskAssignment.status.in_(("submitted", "returned", "accepted"))
                ),
                func.count().filter(TaskAssignment.status == "accepted"),
                func.count().filter(TaskAssignment.status == "submitted"),
            )
            .where(TaskAssignment.task_id.in_(task_ids))
            .group_by(TaskAssignment.task_id)
        )
        for tid, total, submitted, accepted, unreviewed in agg.all():
            assignee_counts[tid] = total
            submitted_counts[tid] = submitted
            accepted_counts[tid] = accepted
            unreviewed_counts[tid] = unreviewed

    # Знаменатель «сдали X из Y»: для common — число участников (назначения ленивы).
    participants = await participant_count(session)

    task_attachments = await resolve_task_attachments(session, task_ids) if task_ids else {}

    # Пары для парных заданий (участник видит свою, админ — все).
    pairs_by_task: dict[int, list[PairOut]] = {}
    for t in tasks:
        if t.type == "pair":
            visible = await _visible_pairs_for(session, t, current_user)
            if visible is not None:
                pairs_by_task[t.id] = visible

    items = [
        TaskWithStatusOut(
            id=t.id,
            type=t.type,
            title=t.title,
            body=t.body,
            kb_item_id=t.kb_item_id,
            pair_id=t.pair_id,
            deadline_at=t.deadline_at,
            created_by=t.created_by,
            created_at=t.created_at,
            attachments=task_attachments.get(t.id, []),
            pairs=pairs_by_task.get(t.id),
            my_status=(a.status if (a := my_assignments.get(t.id)) else None),
            late=bool(a.late) if (a := my_assignments.get(t.id)) else False,
            deadline_soon=deadline_soon(t, now, days),
            assignee_count=(
                assignee_counts.get(t.id, 0)
                if t.type in ("individual", "pair")
                else None
            ),
            submitted_count=submitted_counts.get(t.id, 0),
            accepted_count=accepted_counts.get(t.id, 0),
            unreviewed_count=unreviewed_counts.get(t.id, 0),
            total_recipients=(
                assignee_counts.get(t.id, 0)
                if t.type in ("individual", "pair")
                else participants
            ),
        )
        for t in tasks
    ]

    done, total = await compute_progress(session, current_user)
    attention = await attention_count(session, current_user)
    return TaskListOut(
        items=items,
        progress=ProgressOut(done=done, total=total),
        attention_count=attention,
    )


@router.get("/{task_id}", response_model=TaskWithStatusOut)
async def get_task(
    task_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskWithStatusOut:
    """Одна задача с состоянием юзера. individual — только адресат/админ (иначе 403)."""
    task = await load_task(session, task_id)
    await assert_task_visible(session, task, current_user)

    now = datetime.now(UTC)
    my = await session.scalar(
        select(TaskAssignment).where(
            TaskAssignment.task_id == task.id,
            TaskAssignment.user_id == current_user.id,
        )
    )
    agg = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(
                    TaskAssignment.status.in_(("submitted", "returned", "accepted"))
                ),
                func.count().filter(TaskAssignment.status == "accepted"),
                func.count().filter(TaskAssignment.status == "submitted"),
            ).where(TaskAssignment.task_id == task.id)
        )
    ).one()
    total, submitted, accepted, unreviewed = agg
    task_attachments = (await resolve_task_attachments(session, [task.id])).get(task.id, [])
    return TaskWithStatusOut(
        id=task.id,
        type=task.type,
        title=task.title,
        body=task.body,
        kb_item_id=task.kb_item_id,
        pair_id=task.pair_id,
        deadline_at=task.deadline_at,
        created_by=task.created_by,
        created_at=task.created_at,
        attachments=task_attachments,
        pairs=await _visible_pairs_for(session, task, current_user),
        my_status=my.status if my else None,
        late=bool(my.late) if my else False,
        deadline_soon=deadline_soon(task, now, settings.task_deadline_soon_days),
        assignee_count=(total if task.type in ("individual", "pair") else None),
        submitted_count=submitted,
        accepted_count=accepted,
        unreviewed_count=unreviewed,
        total_recipients=(
            total
            if task.type in ("individual", "pair")
            else await participant_count(session)
        ),
    )


@router.get("/{task_id}/submissions", response_model=list[TaskTrackOut])
async def list_task_submissions(
    task_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TaskTrackOut]:
    """Треки сдач по задаче.

    common: публично — все треки, где есть ≥1 сдача. individual: admin → все треки
    адресатов; участник → только собственный трек.
    """
    task = await load_task(session, task_id)
    await assert_task_visible(session, task, current_user)

    assignments = list(
        (
            await session.execute(
                select(TaskAssignment).where(TaskAssignment.task_id == task.id)
            )
        )
        .scalars()
        .all()
    )

    if task.type == "individual" and current_user.role != "admin":
        # Обычно участник видит только свой трек. Исключение: автор перекрёстной
        # задачи (выдал её партнёру) — видит трек партнёра, чтобы её проверить.
        is_cross_author = task.pair_id is not None and task.created_by == current_user.id
        if not is_cross_author:
            assignments = [a for a in assignments if a.user_id == current_user.id]

    tracks = [await _track_out(session, a) for a in assignments]

    if task.type == "common":
        # Публичны только треки с хотя бы одной сдачей.
        tracks = [t for t in tracks if t.submissions]
    return tracks


@router.post("/{task_id}/submissions", response_model=SubmissionOut, status_code=201)
async def create_submission(
    task_id: int,
    body: SubmissionCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SubmissionOut:
    """Сдать задачу: текст и/или свои вложения. Ставит назначение в 'submitted',
    late=True если дедлайн прошёл и это первая сдача трека. Фан-аут submission.new.
    """
    await enforce_rate_limit(
        f"rl:send:{current_user.id}", settings.rate_limit_send_per_minute
    )
    task = await load_task(session, task_id)
    await assert_task_visible(session, task, current_user)
    assignment = await get_or_create_assignment(session, task, current_user)

    if body.attachment_ids:
        # Прикрепить можно только свои ассеты (нельзя подставить чужой id — IDOR).
        found = await session.execute(
            select(MediaAsset.id).where(
                MediaAsset.id.in_(body.attachment_ids),
                MediaAsset.created_by == current_user.id,
            )
        )
        if set(found.scalars().all()) != set(body.attachment_ids):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")

    # Первая ли это сдача трека — определяем ДО вставки новой.
    is_first = (
        await session.scalar(
            select(func.count())
            .select_from(TaskSubmission)
            .where(TaskSubmission.assignment_id == assignment.id)
        )
    ) == 0

    submission = TaskSubmission(assignment_id=assignment.id, body=body.body)
    session.add(submission)
    await session.flush()

    for aid in dict.fromkeys(body.attachment_ids):
        session.add(
            TaskSubmissionMedia(submission_id=submission.id, media_asset_id=aid)
        )

    assignment.status = "submitted"
    if (
        is_first
        and task.deadline_at is not None
        and datetime.now(UTC) > task.deadline_at
    ):
        assignment.late = True
    await session.flush()
    await session.refresh(submission)

    await fan_out_task_event(
        session,
        task,
        ws_schemas.task_submission_new_event(
            task.id, assignment.id, submission.id, current_user.id
        ),
    )
    attachments = (
        await resolve_submission_attachments(session, [submission.id])
    ).get(submission.id, [])
    return SubmissionOut(
        id=submission.id,
        assignment_id=assignment.id,
        user_id=current_user.id,
        body=submission.body,
        created_at=submission.created_at,
        attachments=attachments,
    )


@router.get("/{task_id}/assignments", response_model=list[AdminAssignmentOut])
async def list_task_assignments(
    task_id: int,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[AdminAssignmentOut]:
    """Админский экран прогресса задачи: строки назначений + число сдач.

    Для common здесь только те, кто уже взаимодействовал (у кого лениво создана
    строка назначения); не взаимодействовавшие ещё не имеют строки.
    """
    task = await load_task(session, task_id)

    rows = await session.execute(
        select(
            TaskAssignment,
            func.count(TaskSubmission.id),
        )
        .outerjoin(
            TaskSubmission, TaskSubmission.assignment_id == TaskAssignment.id
        )
        .where(TaskAssignment.task_id == task.id)
        .group_by(TaskAssignment.id)
        .order_by(TaskAssignment.id)
    )
    return [
        AdminAssignmentOut(
            assignment_id=a.id,
            user_id=a.user_id,
            status=a.status,
            late=a.late,
            reviewed_at=a.reviewed_at,
            submission_count=count,
        )
        for a, count in rows.all()
    ]


# --- внутренние хелперы -----------------------------------------------------


async def _track_out(
    session: AsyncSession, assignment: TaskAssignment
) -> TaskTrackOut:
    """Собрать трек (назначение + его сдачи с вложениями) в TaskTrackOut."""
    submissions = list(
        (
            await session.execute(
                select(TaskSubmission)
                .where(TaskSubmission.assignment_id == assignment.id)
                .order_by(TaskSubmission.created_at, TaskSubmission.id)
            )
        )
        .scalars()
        .all()
    )
    attachments = await resolve_submission_attachments(
        session, [s.id for s in submissions]
    )
    return TaskTrackOut(
        assignment_id=assignment.id,
        user_id=assignment.user_id,
        status=assignment.status,
        late=assignment.late,
        reviewed_at=assignment.reviewed_at,
        submissions=[
            SubmissionOut(
                id=s.id,
                assignment_id=assignment.id,
                user_id=assignment.user_id,
                body=s.body,
                created_at=s.created_at,
                attachments=attachments.get(s.id, []),
            )
            for s in submissions
        ],
    )


async def _load_visible_submission(
    session: AsyncSession, submission_id: int, user: User
) -> tuple[TaskSubmission, Task]:
    """Загрузить сдачу и её задачу, проверив видимость задачи для юзера (анти-IDOR)."""
    submission = await session.get(TaskSubmission, submission_id)
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    assignment = await session.get(TaskAssignment, submission.assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    task = await load_task(session, assignment.task_id)
    await assert_task_visible(session, task, user)
    return submission, task
