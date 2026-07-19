"""Бизнес-логика «потока» (task.type='stream'): турнирная сетка слияний.

Механика. Участники разбиваются на пары (task_stream_nodes раунда 1), пары сливаются
в четвёрки, четвёрки в восьмёрки — и так до единственного корневого узла. Задача идёт
ЛЕСТНИЦЕЙ стадий, общей для всей задачи (жёсткая синхронизация, дедлайн на стадию —
в tasks.deadline_at):

    стадия 0      — все пишут личный текст версии 0
    стадия 1      — узлы раунда 1 (пары) утверждают общую фразу
    стадия 2      — все переписывают текст → версия 1
    стадия 3      — узлы раунда 2 (четвёрки) утверждают фразу
    …
    стадия 2*depth   — финальный текст (версия depth)
    стадия 2*depth+1 — поток завершён

Чётная стадия = text, нечётная = phrase. Всего стадий 2*depth+1; значение stage,
равное 2*depth+1, означает «поток закрыт».

Видимость (анти-IDOR, CLAUDE.md п.1) — здесь она и живёт:
- личный текст версии k виден автору всегда; остальным — только после закрытия
  стадии, на которой он писался (stage >= 2k+1), и только тем, с кем автор лежит в
  одном узле раунда k+1. Финальная версия (k == depth) по закрытии потока видна всем
  участникам;
- фраза узла видна его членам; членам родительского узла — после закрытия
  соответствующей phrase-стадии (это и есть «видна фраза соседней подгруппы»);
  корневая фраза по её утверждении видна всем участникам;
- админ видит всё.
"""
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import after_commit
from app.models.room import Room, RoomMember
from app.models.task import (
    Task,
    TaskAssignment,
    TaskStream,
    TaskStreamNode,
    TaskStreamNodeMember,
    TaskStreamOption,
    TaskStreamText,
    TaskStreamVote,
)
from app.models.user import User
from app.schemas.task import (
    StreamNodeOut,
    StreamOptionOut,
    StreamOut,
    StreamParticipantOut,
)
from app.ws import schemas as ws_schemas
from app.ws.pubsub import publish_user_event

logger = logging.getLogger(__name__)

MIN_PARTICIPANTS = 2


# --- построение сетки (чистые функции, без БД) -------------------------------


@dataclass
class _BuildNode:
    """Промежуточный узел при сборке дерева (до записи в БД)."""

    round: int
    members: list[int]
    children: list["_BuildNode"] = field(default_factory=list)
    position: int = 0
    side: str | None = None


@dataclass(frozen=True)
class NodeSpec:
    """Плоское описание узла сетки. `children` — индексы в этом же списке."""

    round: int
    position: int
    side: str | None
    member_ids: tuple[int, ...]
    child_indexes: tuple[int, ...]
    parent_index: int | None


def _chunk[T](items: list[T]) -> list[list[T]]:
    """Разбить по 2; при нечётной длине последняя группа — тройка.

    13 участников → 5 пар + 1 тройка. Тем же способом сливаются и узлы наверх, так
    что сетка переживает любое число участников >= 2 (см. docs/TASKS.md, «Поток»).
    """
    n = len(items)
    if n % 2 == 0:
        return [items[i : i + 2] for i in range(0, n, 2)]
    head = items[:-3]
    return [head[i : i + 2] for i in range(0, len(head), 2)] + [items[-3:]]


def build_bracket(user_ids: list[int], *, shuffle: bool = True) -> list[NodeSpec]:
    """Собрать сетку из списка участников. Чистая функция (кроме shuffle).

    Возвращает узлы, отсортированные по (round, position). Левое поддерево корня
    идёт первым в каждом раунде — канва рисует его слева, правое справа, корень в
    центре.
    """
    if len(user_ids) < MIN_PARTICIPANTS:
        raise ValueError("stream needs at least 2 participants")
    if len(set(user_ids)) != len(user_ids):
        raise ValueError("duplicate participants")

    ordered = list(user_ids)
    if shuffle:
        random.shuffle(ordered)

    level = [_BuildNode(round=1, members=list(g)) for g in _chunk(ordered)]
    all_nodes = list(level)
    current_round = 1
    while len(level) > 1:
        current_round += 1
        parents: list[_BuildNode] = []
        for group in _chunk(level):
            parent = _BuildNode(
                round=current_round,
                members=[uid for child in group for uid in child.members],
                children=list(group),
            )
            parents.append(parent)
        level = parents
        all_nodes.extend(parents)

    # Сторона канвы наследуется от детей корня — так поддеревья не перемешиваются.
    root = level[0]
    for index, child in enumerate(root.children):
        _assign_side(child, "left" if index == 0 else "right")

    by_round: dict[int, list[_BuildNode]] = {}
    for node in all_nodes:
        by_round.setdefault(node.round, []).append(node)
    for nodes in by_round.values():
        for position, node in enumerate(nodes):
            node.position = position

    flat = [n for r in sorted(by_round) for n in by_round[r]]
    index_of = {id(node): i for i, node in enumerate(flat)}
    parent_of: dict[int, int] = {}
    for i, node in enumerate(flat):
        for child in node.children:
            parent_of[index_of[id(child)]] = i

    return [
        NodeSpec(
            round=node.round,
            position=node.position,
            side=node.side,
            member_ids=tuple(node.members),
            child_indexes=tuple(index_of[id(c)] for c in node.children),
            parent_index=parent_of.get(i),
        )
        for i, node in enumerate(flat)
    ]


def _assign_side(node: _BuildNode, side: str) -> None:
    node.side = side
    for child in node.children:
        _assign_side(child, side)


def node_label(member_count: int, position: int, is_root: bool) -> str:
    """Человекочитаемое имя узла — для названия комнаты и подписи в сетке."""
    if is_root:
        return "Финал"
    names = {2: "Пара", 3: "Тройка", 4: "Четвёрка", 8: "Восьмёрка", 16: "Шестнадцать"}
    return f"{names.get(member_count, 'Группа')} {position + 1}"


# --- арифметика лестницы стадий ----------------------------------------------


def total_stages(depth: int) -> int:
    """Число рабочих стадий. stage == total_stages означает «поток завершён»."""
    return 2 * depth + 1


def stage_kind(stage: int) -> str:
    """'text' — все пишут свою версию; 'phrase' — узлы утверждают общую фразу."""
    return "text" if stage % 2 == 0 else "phrase"


def stage_version(stage: int) -> int:
    """Номер версии личного текста, который пишется на этой text-стадии."""
    return stage // 2


def stage_round(stage: int) -> int:
    """Раунд узлов, утверждающих фразу на этой phrase-стадии."""
    return (stage + 1) // 2


def is_finished(stream: TaskStream) -> bool:
    return stream.stage >= total_stages(stream.depth)


# --- загрузка и доступ --------------------------------------------------------


async def load_stream(session: AsyncSession, task_id: int) -> TaskStream:
    """Поток задачи существует и не удалён, иначе 404."""
    stream = await session.scalar(
        select(TaskStream).where(
            TaskStream.task_id == task_id, TaskStream.deleted_at.is_(None)
        )
    )
    if stream is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stream not found")
    return stream


async def load_node(
    session: AsyncSession, task_id: int, node_id: int
) -> TaskStreamNode:
    """Узел существует, не удалён и принадлежит ЭТОЙ задаче (анти-IDOR), иначе 404."""
    node = await session.get(TaskStreamNode, node_id)
    if node is None or node.deleted_at is not None or node.task_id != task_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Node not found")
    return node


async def node_member_ids(session: AsyncSession, node_id: int) -> list[int]:
    rows = await session.execute(
        select(TaskStreamNodeMember.user_id)
        .where(TaskStreamNodeMember.node_id == node_id)
        .order_by(TaskStreamNodeMember.user_id)
    )
    return list(rows.scalars().all())


async def participant_ids(session: AsyncSession, task_id: int) -> list[int]:
    """Все участники потока (членство раунда 1 покрывает всех ровно один раз)."""
    rows = await session.execute(
        select(TaskStreamNodeMember.user_id)
        .join(TaskStreamNode, TaskStreamNode.id == TaskStreamNodeMember.node_id)
        .where(
            TaskStreamNodeMember.task_id == task_id,
            TaskStreamNode.round == 1,
            TaskStreamNode.deleted_at.is_(None),
        )
        .order_by(TaskStreamNodeMember.user_id)
    )
    return list(rows.scalars().all())


async def user_nodes(
    session: AsyncSession, task_id: int, user_id: int
) -> dict[int, int]:
    """{раунд: node_id} — по одному узлу на раунд, если юзер участвует в потоке."""
    rows = await session.execute(
        select(TaskStreamNode.round, TaskStreamNode.id)
        .join(
            TaskStreamNodeMember, TaskStreamNodeMember.node_id == TaskStreamNode.id
        )
        .where(
            TaskStreamNodeMember.task_id == task_id,
            TaskStreamNodeMember.user_id == user_id,
            TaskStreamNode.deleted_at.is_(None),
        )
    )
    return {round_: node_id for round_, node_id in rows.all()}


async def is_stream_member(
    session: AsyncSession, task_id: int, user_id: int
) -> bool:
    row = await session.scalar(
        select(TaskStreamNodeMember.id).where(
            TaskStreamNodeMember.task_id == task_id,
            TaskStreamNodeMember.user_id == user_id,
        )
    )
    return row is not None


async def assert_node_member(
    session: AsyncSession, node: TaskStreamNode, user: User
) -> None:
    """Юзер состоит в узле (админ — нет: писать варианты и голосовать может только
    член подгруппы; продавить фразу у админа есть отдельная ручка).
    """
    if user.id not in await node_member_ids(session, node.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this node")


# --- видимость ----------------------------------------------------------------


def text_visible(
    *,
    stream: TaskStream,
    version: int,
    viewer_id: int,
    author_id: int,
    is_admin: bool,
    shared_round_node: int | None,
) -> bool:
    """Виден ли viewer'у текст `author_id` версии `version`.

    `shared_round_node` — общий node_id автора и зрителя на раунде version+1
    (None, если такого узла нет либо раунда не существует).
    """
    if is_admin or viewer_id == author_id:
        return True
    # До закрытия своей стадии черновик виден только автору.
    if stream.stage < 2 * version + 1:
        return False
    if version + 1 > stream.depth:
        return True  # финальная версия — всем участникам по завершении потока
    return shared_round_node is not None


def phrase_visible(
    *,
    stream: TaskStream,
    node: TaskStreamNode,
    is_admin: bool,
    in_node: bool,
    in_parent_node: bool,
) -> bool:
    """Видна ли viewer'у утверждённая фраза узла."""
    if node.phrase is None:
        return False
    if is_admin or in_node:
        return True
    if node.round == stream.depth:
        return True  # корневая фраза — общая для всех
    return in_parent_node and stream.stage >= 2 * node.round


# --- утверждение фразы --------------------------------------------------------


async def recompute_node_approval(
    session: AsyncSession, node: TaskStreamNode
) -> None:
    """Пересчитать утверждение фразы узла по голосам (единогласие).

    Фраза утверждена, когда ВСЕ члены узла проголосовали за один и тот же вариант.
    Идемпотентна и обратима: если кто-то переголосовал и единогласия больше нет —
    утверждение снимается (но не трогаем фразу, продавленную админом).
    """
    if node.approved_by is not None:
        return  # продавлено админом — голоса больше ничего не решают

    member_ids = await node_member_ids(session, node.id)
    rows = await session.execute(
        select(TaskStreamVote.user_id, TaskStreamVote.option_id).where(
            TaskStreamVote.node_id == node.id
        )
    )
    votes: dict[int, int] = {user_id: option_id for user_id, option_id in rows.all()}

    unanimous_option: int | None = None
    if len(votes) == len(member_ids) and member_ids:
        chosen = set(votes.values())
        if len(chosen) == 1:
            unanimous_option = chosen.pop()

    if unanimous_option is None:
        node.phrase = None
        node.phrase_option_id = None
        node.approved_at = None
        await session.flush()
        return

    option = await session.get(TaskStreamOption, unanimous_option)
    if option is None or option.deleted_at is not None:
        return
    node.phrase = option.text
    node.phrase_option_id = option.id
    node.approved_at = datetime.now(UTC)
    await session.flush()


async def force_phrase(
    session: AsyncSession, node: TaskStreamNode, text: str, admin_id: int
) -> None:
    """Админ продавливает фразу узла (поток не должен зависать на несогласии)."""
    node.phrase = text
    node.phrase_option_id = None
    node.approved_at = datetime.now(UTC)
    node.approved_by = admin_id
    await session.flush()


# --- комнаты узлов ------------------------------------------------------------


async def ensure_node_room(
    session: AsyncSession, task: Task, node: TaskStreamNode, depth: int
) -> Room | None:
    """Создать (идемпотентно) group-комнату обсуждения для узла.

    По образцу services/rooms.ensure_news_channel. У group-комнат нет ленивого
    членства — assert_room_access откажет без строки room_members, поэтому строки
    заводим сразу на всех членов узла.
    """
    if node.room_id is not None:
        return await session.get(Room, node.room_id)

    member_ids = await node_member_ids(session, node.id)
    if not member_ids:
        return None

    label = node_label(len(member_ids), node.position, node.round == depth)
    room = Room(
        type="group",
        name=f"Поток «{task.title}» · {label}",
        created_by=task.created_by,
    )
    session.add(room)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        logger.warning("stream: failed to create room for node %s", node.id)
        return None

    session.add_all(
        [
            RoomMember(room_id=room.id, user_id=uid, role_in_room="member")
            for uid in member_ids
        ]
    )
    node.room_id = room.id
    await session.flush()

    # Комнату создал сервер — клиент о ней не знает. Шлём room.created ПОСЛЕ commit
    # (иначе при откате транзакции у юзера мигнёт несуществующая комната).
    event = ws_schemas.room_created_event(room.id)
    for uid in member_ids:
        after_commit(session, _room_hook(uid, event))
    return room


def _room_hook(user_id: int, event: dict[str, object]) -> Callable[[], Awaitable[None]]:
    """Явная фабрика (не lambda в цикле) — иначе позднее связывание user_id."""

    async def _hook() -> None:
        await publish_user_event(user_id, event)

    return _hook


# --- переход стадии -----------------------------------------------------------


async def unapproved_nodes(
    session: AsyncSession, task_id: int, round_: int
) -> list[TaskStreamNode]:
    """Узлы раунда без утверждённой фразы (блокируют переход стадии)."""
    rows = await session.execute(
        select(TaskStreamNode).where(
            TaskStreamNode.task_id == task_id,
            TaskStreamNode.round == round_,
            TaskStreamNode.deleted_at.is_(None),
            TaskStreamNode.phrase.is_(None),
        )
    )
    return list(rows.scalars().all())


async def pending_text_user_ids(
    session: AsyncSession, task_id: int, version: int
) -> list[int]:
    """Кто ещё не сдал текст этой версии — админу видно, кто тормозит."""
    everyone = set(await participant_ids(session, task_id))
    rows = await session.execute(
        select(TaskStreamText.user_id).where(
            TaskStreamText.task_id == task_id, TaskStreamText.version == version
        )
    )
    return sorted(everyone - set(rows.scalars().all()))


async def advance_stage(
    session: AsyncSession, task: Task, stream: TaskStream
) -> None:
    """Закрыть текущую стадию и открыть следующую (только админ, см. api/stream.py).

    Из phrase-стадии нельзя уйти, пока хоть один узел раунда без фразы: иначе
    следующая стадия окажется без входных данных. Админ разруливает это, продавив
    фразу (`force_phrase`).
    """
    if is_finished(stream):
        raise HTTPException(status.HTTP_409_CONFLICT, "Stream already finished")

    if stage_kind(stream.stage) == "phrase":
        blocking = await unapproved_nodes(
            session, task.id, stage_round(stream.stage)
        )
        if blocking:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Nodes without an approved phrase: "
                + ", ".join(str(n.id) for n in blocking),
            )

    stream.stage += 1
    await session.flush()

    if not is_finished(stream) and stage_kind(stream.stage) == "phrase":
        round_ = stage_round(stream.stage)
        rows = await session.execute(
            select(TaskStreamNode)
            .where(
                TaskStreamNode.task_id == task.id,
                TaskStreamNode.round == round_,
                TaskStreamNode.deleted_at.is_(None),
            )
            .order_by(TaskStreamNode.position)
        )
        for node in rows.scalars().all():
            await ensure_node_room(session, task, node, stream.depth)


async def build_stream_out(
    session: AsyncSession, task: Task, stream: TaskStream, viewer: User
) -> StreamOut:
    """Собрать состояние потока глазами `viewer` — одна ручка кормит всю канву.

    Чужие фразы и чужие тексты сюда не попадают: всё, что отдаётся, проходит через
    text_visible/phrase_visible (анти-IDOR).
    """
    is_admin = viewer.role == "admin"
    kind = stage_kind(stream.stage)
    finished = is_finished(stream)
    active_round = None if finished or kind != "phrase" else stage_round(stream.stage)
    active_version = None if finished or kind != "text" else stage_version(stream.stage)

    node_rows = await session.execute(
        select(TaskStreamNode)
        .where(
            TaskStreamNode.task_id == task.id, TaskStreamNode.deleted_at.is_(None)
        )
        .order_by(TaskStreamNode.round, TaskStreamNode.position)
    )
    nodes = list(node_rows.scalars().all())

    member_rows = await session.execute(
        select(TaskStreamNodeMember.node_id, TaskStreamNodeMember.user_id).where(
            TaskStreamNodeMember.task_id == task.id
        )
    )
    members_by_node: dict[int, list[int]] = {}
    for node_id, user_id in member_rows.all():
        members_by_node.setdefault(node_id, []).append(user_id)

    my_node_ids = {
        n.id for n in nodes if viewer.id in members_by_node.get(n.id, [])
    }

    out_nodes: list[StreamNodeOut] = []
    for node in nodes:
        member_ids = sorted(members_by_node.get(node.id, []))
        is_mine = node.id in my_node_ids
        visible = phrase_visible(
            stream=stream,
            node=node,
            is_admin=is_admin,
            in_node=is_mine,
            in_parent_node=node.parent_id in my_node_ids,
        )
        out_nodes.append(
            StreamNodeOut(
                id=node.id,
                round=node.round,
                position=node.position,
                side=node.side,
                parent_id=node.parent_id,
                member_ids=member_ids,
                label=node_label(
                    len(member_ids), node.position, node.round == stream.depth
                ),
                phrase=node.phrase if visible else None,
                approved=node.approved_at is not None,
                approved_by_admin=node.approved_by is not None,
                room_id=node.room_id if (is_mine or is_admin) else None,
                is_mine=is_mine,
                options=[],
                my_vote_option_id=None,
            )
        )

    # Варианты и голоса — только для активного раунда (в остальных они не нужны).
    if active_round is not None:
        active_ids = [n.id for n in nodes if n.round == active_round]
        allowed = (
            active_ids if is_admin else [i for i in active_ids if i in my_node_ids]
        )
        if allowed:
            await _attach_options(session, out_nodes, allowed, viewer.id)

    everyone = await participant_ids(session, task.id)
    check_version = active_version if active_version is not None else stream.depth
    submitted_rows = await session.execute(
        select(TaskStreamText.user_id).where(
            TaskStreamText.task_id == task.id,
            TaskStreamText.version == check_version,
        )
    )
    submitted = set(submitted_rows.scalars().all())

    my_text = None
    if active_version is not None:
        my_text = await session.scalar(
            select(TaskStreamText.body).where(
                TaskStreamText.task_id == task.id,
                TaskStreamText.user_id == viewer.id,
                TaskStreamText.version == active_version,
            )
        )

    return StreamOut(
        depth=stream.depth,
        stage=stream.stage,
        total_stages=total_stages(stream.depth),
        stage_kind=kind,
        stage_round=active_round,
        stage_version=active_version,
        finished=finished,
        deadline_at=task.deadline_at,
        nodes=out_nodes,
        participants=[
            StreamParticipantOut(user_id=uid, submitted_current=uid in submitted)
            for uid in everyone
        ],
        my_current_text=my_text,
        pending_user_ids=(
            sorted(set(everyone) - submitted) if is_admin else None
        ),
    )


async def _attach_options(
    session: AsyncSession,
    out_nodes: list[StreamNodeOut],
    node_ids: list[int],
    viewer_id: int,
) -> None:
    """Дописать варианты фраз и голоса в узлы, которые смотрящему разрешено видеть."""
    option_rows = await session.execute(
        select(TaskStreamOption)
        .where(
            TaskStreamOption.node_id.in_(node_ids),
            TaskStreamOption.deleted_at.is_(None),
        )
        .order_by(TaskStreamOption.created_at)
    )
    options = list(option_rows.scalars().all())
    vote_rows = await session.execute(
        select(
            TaskStreamVote.node_id, TaskStreamVote.option_id, TaskStreamVote.user_id
        ).where(TaskStreamVote.node_id.in_(node_ids))
    )
    voters: dict[int, list[int]] = {}
    my_vote: dict[int, int] = {}
    for node_id, option_id, user_id in vote_rows.all():
        voters.setdefault(option_id, []).append(user_id)
        if user_id == viewer_id:
            my_vote[node_id] = option_id

    by_node: dict[int, list[StreamOptionOut]] = {}
    for option in options:
        by_node.setdefault(option.node_id, []).append(
            StreamOptionOut(
                id=option.id,
                author_id=option.author_id,
                text=option.text,
                voter_ids=sorted(voters.get(option.id, [])),
                created_at=option.created_at,
            )
        )

    for out in out_nodes:
        if out.id in by_node:
            out.options = by_node[out.id]
        if out.id in my_vote:
            out.my_vote_option_id = my_vote[out.id]


async def mark_final_submitted(
    session: AsyncSession, task_id: int, user_id: int
) -> None:
    """Финальный текст сдан → назначение участника закрывается (бейдж/прогресс)."""
    assignment = await session.scalar(
        select(TaskAssignment).where(
            TaskAssignment.task_id == task_id, TaskAssignment.user_id == user_id
        )
    )
    if assignment is not None and assignment.status != "accepted":
        assignment.status = "accepted"
        assignment.reviewed_at = datetime.now(UTC)
        await session.flush()
