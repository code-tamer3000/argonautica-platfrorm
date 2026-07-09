"""Задачи (SPEC: раздел «Задачи»): CRUD задач (admin), сдачи, ревью, комментарии.

Задача общая (`common`, видна всем активным участникам) или индивидуальная
(`individual`, адресована конкретным юзерам). Авторизация на КАЖДОМ запросе
(CLAUDE.md п.1, анти-IDOR): видимость задачи/сдачи проверяется на сервере, id от
клиента не доверяем. Мягкое удаление (п.6). Дедлайн синхронизируется с календарём.
Реалтайм — персональный канал user:{id} (publish_user_event), фан-аут по получателям.

Порядок маршрутов важен: литеральные префиксы (`/assignments/...`, `/submissions/...`,
`/comments/...`) объявлены ДО `/{task_id}`, иначе FastAPI перехватил бы их как task_id.
"""
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
    TaskSubmission,
    TaskSubmissionMedia,
)
from app.models.user import User
from app.schemas.task import (
    AdminAssignmentOut,
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
    assert_task_visible,
    attention_count,
    compute_progress,
    deadline_soon,
    fan_out_task_event,
    get_or_create_assignment,
    load_task,
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

    if body.type == "individual":
        assignee_ids = list(dict.fromkeys(body.assignee_ids))
        if not assignee_ids:
            raise HTTPException(
                422, "Individual task requires at least one assignee"
            )
        await _assert_users_exist(session, assignee_ids)
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
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TaskTrackOut:
    """Ревью сдачи (admin). accept → 'accepted'; return → 'returned' + комментарий
    на последнюю сдачу (обязателен). Оба ставят reviewed_at. Фан-аут статуса адресату.
    """
    assignment = await session.get(TaskAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assignment not found")
    task = await load_task(session, assignment.task_id)

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
                author_id=current_admin.id,
                body=body.comment,
            )
        )
        assignment.status = "returned"
    assignment.reviewed_at = datetime.now(UTC)
    await session.flush()

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

    # Агрегаты по назначениям задачи (кол-во адресатов, сдано, принято).
    assignee_counts: dict[int, int] = {}
    submitted_counts: dict[int, int] = {}
    accepted_counts: dict[int, int] = {}
    if task_ids:
        agg = await session.execute(
            select(
                TaskAssignment.task_id,
                func.count(),
                func.count().filter(
                    TaskAssignment.status.in_(("submitted", "returned", "accepted"))
                ),
                func.count().filter(TaskAssignment.status == "accepted"),
            )
            .where(TaskAssignment.task_id.in_(task_ids))
            .group_by(TaskAssignment.task_id)
        )
        for tid, total, submitted, accepted in agg.all():
            assignee_counts[tid] = total
            submitted_counts[tid] = submitted
            accepted_counts[tid] = accepted

    task_attachments = await resolve_task_attachments(session, task_ids) if task_ids else {}

    items = [
        TaskWithStatusOut(
            id=t.id,
            type=t.type,
            title=t.title,
            body=t.body,
            kb_item_id=t.kb_item_id,
            deadline_at=t.deadline_at,
            created_by=t.created_by,
            created_at=t.created_at,
            attachments=task_attachments.get(t.id, []),
            my_status=(a.status if (a := my_assignments.get(t.id)) else None),
            late=bool(a.late) if (a := my_assignments.get(t.id)) else False,
            deadline_soon=deadline_soon(t, now, days),
            assignee_count=(
                assignee_counts.get(t.id, 0) if t.type == "individual" else None
            ),
            submitted_count=submitted_counts.get(t.id, 0),
            accepted_count=accepted_counts.get(t.id, 0),
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
            ).where(TaskAssignment.task_id == task.id)
        )
    ).one()
    total, submitted, accepted = agg
    task_attachments = (await resolve_task_attachments(session, [task.id])).get(task.id, [])
    return TaskWithStatusOut(
        id=task.id,
        type=task.type,
        title=task.title,
        body=task.body,
        kb_item_id=task.kb_item_id,
        deadline_at=task.deadline_at,
        created_by=task.created_by,
        created_at=task.created_at,
        attachments=task_attachments,
        my_status=my.status if my else None,
        late=bool(my.late) if my else False,
        deadline_soon=deadline_soon(task, now, settings.task_deadline_soon_days),
        assignee_count=(total if task.type == "individual" else None),
        submitted_count=submitted,
        accepted_count=accepted,
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
