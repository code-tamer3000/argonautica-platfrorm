"""Записи задачи «Структура». Одно назначение объединяет все записи участника."""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_participant
from app.core.config import settings
from app.db.session import after_commit, get_session
from app.models.task import TaskSubmission
from app.models.user import User
from app.schemas.structure import StructureEntryCreate
from app.schemas.task import SubmissionOut
from app.services.graduation import assert_not_graduated
from app.services.ratelimit import enforce_rate_limit
from app.services.tasks import (
    assert_task_visible,
    get_or_create_assignment,
    load_task,
    task_recipients,
)
from app.ws import schemas as ws_schemas
from app.ws.pubsub import publish_user_event

router = APIRouter(prefix="/api/tasks", tags=["tasks"], dependencies=[Depends(require_participant)])


@router.post("/{task_id}/entries", status_code=201, response_model=SubmissionOut)
async def add_structure_entry(
    task_id: int,
    body: StructureEntryCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SubmissionOut:
    await enforce_rate_limit(
        f"rl:send:{current_user.id}", settings.rate_limit_send_per_minute
    )
    task = await load_task(session, task_id)
    await session.refresh(task, with_for_update=True)
    if task.deleted_at is not None or task.type != "structure":
        raise HTTPException(404, "Структура не найдена")
    await assert_task_visible(session, task, current_user)
    assert_not_graduated(current_user)
    if current_user.role != "participant":
        raise HTTPException(403, "Записи добавляют участники")
    if not task.deadline_at or datetime.now(UTC) >= task.deadline_at:
        raise HTTPException(409, "Срок добавления записей истёк")
    questions = task.questions or []
    if set(body.answers) != {q["id"] for q in questions}:
        raise HTTPException(422, "Заполните все вопросы текущей формы")
    for q in questions:
        value = body.answers[q["id"]]
        if q["kind"] == "scale":
            if not isinstance(value, int) or not 1 <= value <= 10:
                raise HTTPException(422, "Выберите число от 1 до 10")
        elif not isinstance(value, str) or not value.strip():
            raise HTTPException(422, "Введите текст ответа")

    assignment = await get_or_create_assignment(session, task, current_user)
    if assignment.status == "accepted":
        raise HTTPException(409, "Работа уже принята")
    submission = TaskSubmission(assignment_id=assignment.id, answers=body.answers)
    session.add(submission)
    assignment.status = "submitted"
    await session.flush()
    event = ws_schemas.task_submission_new_event(
        task.id, assignment.id, submission.id, current_user.id
    )
    # Resolve recipients before closing the transaction, then notify committed data only.
    recipients = await task_recipients(session, task)

    async def notify() -> None:
        for uid in recipients:
            await publish_user_event(uid, event)

    after_commit(session, notify)
    return SubmissionOut(
        id=submission.id, assignment_id=assignment.id, user_id=current_user.id,
        body=None, answers=submission.answers, created_at=submission.created_at,
    )
