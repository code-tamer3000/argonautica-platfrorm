"""Эндпоинты «потока» — `/api/tasks/{task_id}/stream/...`.

Роутер подключается ДО `/api/tasks/{task_id}` (порядок маршрутов, см. api/tasks.py),
и, как весь раздел «Задачи», закрыт `require_participant` (наблюдателям — 403).

Авторизация на каждом запросе (анти-IDOR): сначала `assert_task_visible` (юзер вообще
в этом потоке), затем — для мутаций внутри узла — `assert_node_member`. Ничего из
того, что смотрящему ещё не открыто, наружу не отдаётся: сборка ответа целиком идёт
через services/stream.build_stream_out.

Глобальных стадий нет — подгруппы двигаются сами, поэтому и ручки «следующая стадия»
нет: что кому доступно, вычисляется из сданных текстов и утверждённых фраз. Дедлайн у
потока один и правится обычным PATCH /api/tasks/{id}.
"""
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_admin, require_participant
from app.db.session import get_session
from app.models.task import (
    Task,
    TaskStream,
    TaskStreamOption,
    TaskStreamText,
    TaskStreamVote,
)
from app.models.user import User
from app.schemas.task import (
    StreamOptionInput,
    StreamOut,
    StreamPhraseInput,
    StreamTextInput,
    StreamTextOut,
    StreamVoteInput,
)
from app.services import stream as stream_service
from app.services.tasks import (
    assert_task_visible,
    fan_out_task_event,
    load_task,
)
from app.ws import schemas as ws_schemas

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/tasks/{task_id}/stream",
    tags=["stream"],
    dependencies=[Depends(require_participant)],
)


async def _load_visible(
    session: AsyncSession, task_id: int, user: User
) -> tuple[Task, TaskStream]:
    """Задача-поток видна юзеру + её stream. Общий пролог всех ручек."""
    task = await load_task(session, task_id)
    if task.type != "stream":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a stream task")
    await assert_task_visible(session, task, user)
    stream = await stream_service.load_stream(session, task.id)
    return task, stream


async def _notify(session: AsyncSession, task: Task) -> None:
    """Любая мутация потока = обновление родительской задачи для всех получателей."""
    await fan_out_task_event(session, task, ws_schemas.task_updated_event(task.id))


@router.get("", response_model=StreamOut)
async def get_stream(
    task_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StreamOut:
    """Полное состояние сетки глазами смотрящего."""
    task, stream = await _load_visible(session, task_id, current_user)
    return await stream_service.build_stream_out(session, task, stream, current_user)


@router.get("/texts/{user_id}", response_model=list[StreamTextOut])
async def get_user_texts(
    task_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[StreamTextOut]:
    """Версии текста участника, ВИДИМЫЕ смотрящему (клик по узлу сетки).

    Невидимые версии просто не попадают в ответ — 403 не отдаём, чтобы не сливать
    сам факт их существования.
    """
    task, stream = await _load_visible(session, task_id, current_user)
    if not await stream_service.is_stream_member(session, task.id, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a stream participant")

    viewer_nodes = await stream_service.user_nodes(session, task.id, current_user.id)
    target_nodes = await stream_service.user_nodes(session, task.id, user_id)
    is_admin = current_user.role == "admin"

    texts = await stream_service.texts_by_user(session, task.id)
    everyone = await stream_service.participant_ids(session, task.id)
    all_finals_in = bool(everyone) and all(
        stream.depth in texts.get(uid, set()) for uid in everyone
    )

    rows = await session.execute(
        select(TaskStreamText)
        .where(
            TaskStreamText.task_id == task.id, TaskStreamText.user_id == user_id
        )
        .order_by(TaskStreamText.version)
    )
    out: list[StreamTextOut] = []
    for text in rows.scalars().all():
        # Общий узел следующего раунда — и он должен быть укомплектован: пока хоть
        # кто-то из подгруппы не сдал, черновики закрыты даже от напарника.
        shared = viewer_nodes.get(text.version + 1)
        shared_ready = False
        if shared is not None and shared == target_nodes.get(text.version + 1):
            members = await stream_service.node_member_ids(session, shared)
            shared_ready = stream_service.node_ready(
                text.version + 1, members, texts
            )
        visible = stream_service.text_visible(
            version=text.version,
            depth=stream.depth,
            viewer_id=current_user.id,
            author_id=user_id,
            is_admin=is_admin,
            shared_node_ready=shared_ready,
            all_finals_in=all_finals_in,
        )
        if visible:
            out.append(
                StreamTextOut(
                    version=text.version, body=text.body, updated_at=text.updated_at
                )
            )
    return out


@router.put("/texts", response_model=StreamOut)
async def put_my_text(
    task_id: int,
    body: StreamTextInput,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StreamOut:
    """Сохранить/переписать свой текст текущей text-стадии.

    Правится до перехода стадии (в отличие от task_submissions истории не ведём —
    история версий здесь и так есть, по одной на раунд).
    """
    task, stream = await _load_visible(session, task_id, current_user)
    if not await stream_service.is_stream_member(session, task.id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a stream participant")

    # Какую версию юзер вправе писать — решает сервер по состоянию ЕГО ветки сетки.
    state = await stream_service.build_stream_out(session, task, stream, current_user)
    version = state.my_version
    existing = await session.scalar(
        select(TaskStreamText).where(
            TaskStreamText.task_id == task.id,
            TaskStreamText.user_id == current_user.id,
            TaskStreamText.version == version,
        )
    )
    if existing is None:
        session.add(
            TaskStreamText(
                task_id=task.id,
                user_id=current_user.id,
                version=version,
                body=body.body,
            )
        )
    else:
        existing.body = body.body
        existing.updated_at = datetime.now(UTC)
    await session.flush()

    if version == stream.depth:
        await stream_service.mark_final_submitted(session, task.id, current_user.id)
    else:
        # Подгруппа могла только что укомплектоваться — заводим ей комнату.
        await stream_service.open_ready_node(
            session, task, stream, current_user.id, version
        )

    await _notify(session, task)
    return await stream_service.build_stream_out(session, task, stream, current_user)


@router.post("/nodes/{node_id}/options", response_model=StreamOut, status_code=201)
async def create_option(
    task_id: int,
    node_id: int,
    body: StreamOptionInput,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StreamOut:
    """Предложить вариант общей фразы в своём узле."""
    task, stream = await _load_visible(session, task_id, current_user)
    node = await stream_service.load_node(session, task.id, node_id)
    await stream_service.assert_node_member(session, node, current_user)
    await stream_service.assert_node_open_for_voting(session, task.id, node)

    session.add(
        TaskStreamOption(
            node_id=node.id, author_id=current_user.id, text=body.text
        )
    )
    await session.flush()
    await _notify(session, task)
    return await stream_service.build_stream_out(session, task, stream, current_user)


@router.delete("/nodes/{node_id}/options/{option_id}", status_code=204)
async def delete_option(
    task_id: int,
    node_id: int,
    option_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> Response:
    """Снять свой вариант (автор, до утверждения фразы). Мягкое удаление."""
    task, stream = await _load_visible(session, task_id, current_user)
    node = await stream_service.load_node(session, task.id, node_id)
    await stream_service.assert_node_member(session, node, current_user)

    option = await session.get(TaskStreamOption, option_id)
    if option is None or option.deleted_at is not None or option.node_id != node.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Option not found")
    if option.author_id != current_user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your option")
    if node.approved_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Phrase already approved")

    option.deleted_at = datetime.now(UTC)
    # Голоса за снятый вариант тоже уходят — иначе единогласие «залипнет».
    await session.execute(
        sa_delete(TaskStreamVote).where(TaskStreamVote.option_id == option.id)
    )
    await session.flush()
    await stream_service.recompute_node_approval(session, node)
    await _notify(session, task)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.put("/nodes/{node_id}/vote", response_model=StreamOut)
async def cast_vote(
    task_id: int,
    node_id: int,
    body: StreamVoteInput,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StreamOut:
    """Отдать/сменить голос. Единогласие узла утверждает фразу (см. сервис)."""
    task, stream = await _load_visible(session, task_id, current_user)
    node = await stream_service.load_node(session, task.id, node_id)
    await stream_service.assert_node_member(session, node, current_user)
    await stream_service.assert_node_open_for_voting(session, task.id, node)

    option = await session.get(TaskStreamOption, body.option_id)
    if option is None or option.deleted_at is not None or option.node_id != node.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Option not found")

    existing = await session.scalar(
        select(TaskStreamVote).where(
            TaskStreamVote.node_id == node.id,
            TaskStreamVote.user_id == current_user.id,
        )
    )
    if existing is None:
        session.add(
            TaskStreamVote(
                node_id=node.id, option_id=option.id, user_id=current_user.id
            )
        )
    else:
        existing.option_id = option.id
    await session.flush()

    await stream_service.recompute_node_approval(session, node)
    await _notify(session, task)
    return await stream_service.build_stream_out(session, task, stream, current_user)


@router.patch("/nodes/{node_id}/phrase", response_model=StreamOut)
async def set_phrase(
    task_id: int,
    node_id: int,
    body: StreamPhraseInput,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> StreamOut:
    """Админ продавливает фразу узла — чтобы поток не завис на несогласии."""
    task, stream = await _load_visible(session, task_id, current_admin)
    node = await stream_service.load_node(session, task.id, node_id)
    await stream_service.force_phrase(session, node, body.text, current_admin.id)
    await _notify(session, task)
    return await stream_service.build_stream_out(session, task, stream, current_admin)
