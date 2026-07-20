"""Бизнес-логика «потока» (task.type='stream'): турнирная сетка слияний.

Механика. Участники разбиваются на пары (task_stream_nodes раунда 1), пары сливаются
в четвёрки, четвёрки в восьмёрки — и так до единственного корневого узла.

ПРОДВИЖЕНИЕ ЛОКАЛЬНОЕ, глобальных стадий нет. Подгруппа, закончившая работу, идёт
дальше сразу и ждёт только своих соседей — не всю когорту. Состояние нигде не
хранится, оно ВЫВОДИТСЯ из сданных текстов и утверждённых фраз:

- узел ГОТОВ выбирать фразу, когда все его члены сдали текст версии `round - 1`;
- фраза утверждается единогласием членов узла и после этого ФИКСИРУЕТСЯ (на неё уже
  опираются соседи сверху; передумывать поздно — остаётся продавливание админом);
- участник может писать версию `k`, когда утверждены все дочерние узлы его узла
  раунда `k+1` — то есть его собственная подгруппа И соседние в пределах следующей
  группы. Для последней версии (`k == depth`) условие — утверждена корневая фраза.

Отсюда и «сделали и ждём соседей»: пара голосует, как только оба написали, а
упирается лишь в соседнюю пару, когда приходит время переписывать текст.

Видимость (анти-IDOR, CLAUDE.md п.1) — здесь она и живёт:
- личный текст версии k виден автору всегда; остальным — когда узел раунда k+1, в
  котором лежат и автор, и смотрящий, набрал тексты ОТ ВСЕХ своих членов (то есть
  напарник открывается ровно тогда, когда вы оба сдали). Финальная версия
  (k == depth) открывается всем участникам, когда её сдали все;
- фраза узла видна его членам и членам родительского узла — с момента утверждения
  (это и есть «видна фраза соседней подгруппы»); корневая — всем участникам;
- админ видит всё.

`task_streams.stage` больше не используется (осталась от версии с глобальными
стадиями; колонку снимем отдельным релизом — expand/contract, CLAUDE.md).
"""
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import delete as sa_delete
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


# --- выводимое состояние (вместо глобальных стадий) --------------------------


def node_ready(round_: int, member_ids: list[int], texts: dict[int, set[int]]) -> bool:
    """Все члены узла сдали текст своего раунда → узел вправе выбирать фразу."""
    needed = round_ - 1
    return bool(member_ids) and all(
        needed in texts.get(uid, set()) for uid in member_ids
    )


def current_version(
    depth: int,
    my_nodes: dict[int, int],
    approved: set[int],
    children: dict[int, list[int]],
) -> int:
    """Какую версию текста участник вправе писать сейчас.

    Поднимаемся по своей ветке, пока выполняются предпосылки: чтобы писать версию k,
    нужны утверждённые фразы всех дочерних узлов своего узла раунда k+1 (своя
    подгруппа плюс соседние), а для последней версии — утверждённая корневая фраза.
    Условие монотонно: узел раунда k утверждается не раньше, чем все его члены сдали
    версию k-1, поэтому «перепрыгнуть» версию нельзя.
    """
    version = 0
    while version < depth:
        nxt = version + 1
        if nxt == depth:
            root = my_nodes.get(depth)
            ok = root is not None and root in approved
        else:
            parent = my_nodes.get(nxt + 1)
            ok = parent is not None and all(
                child in approved for child in children.get(parent, [])
            )
        if not ok:
            break
        version = nxt
    return version


def waiting_on(
    depth: int,
    version: int,
    my_nodes: dict[int, int],
    approved: set[int],
    children: dict[int, list[int]],
) -> list[int]:
    """Узлы, чьих фраз участник ждёт, чтобы писать следующую версию."""
    if version >= depth:
        return []
    nxt = version + 1
    if nxt == depth:
        root = my_nodes.get(depth)
        return [] if root is None or root in approved else [root]
    parent = my_nodes.get(nxt + 1)
    if parent is None:
        return []
    return [c for c in children.get(parent, []) if c not in approved]


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
    version: int,
    depth: int,
    viewer_id: int,
    author_id: int,
    is_admin: bool,
    shared_node_ready: bool,
    all_finals_in: bool,
) -> bool:
    """Виден ли viewer'у текст `author_id` версии `version`.

    `shared_node_ready` — автор и смотрящий лежат в одном узле раунда version+1 И
    этот узел набрал тексты от всех своих членов. Пока хоть кто-то в узле не сдал,
    черновики закрыты даже от напарника: иначе можно подсмотреть и подстроиться.
    """
    if is_admin or viewer_id == author_id:
        return True
    if version >= depth:
        # Финальная версия: открывается всем участникам, когда её сдали все.
        return all_finals_in
    return shared_node_ready


def phrase_visible(
    *,
    node: TaskStreamNode,
    depth: int,
    is_admin: bool,
    in_node: bool,
    in_parent_node: bool,
) -> bool:
    """Видна ли viewer'у утверждённая фраза узла.

    Отдельного гейта по времени не нужно: фраза появляется только при утверждении,
    а членам родительского узла она в этот момент и требуется — именно на её основе
    они переписывают свой текст.
    """
    if node.phrase is None:
        return False
    if is_admin or in_node:
        return True
    if node.round == depth:
        return True  # корневая фраза — общая для всех
    return in_parent_node


# --- утверждение фразы --------------------------------------------------------


async def recompute_node_approval(
    session: AsyncSession, node: TaskStreamNode
) -> None:
    """Пересчитать утверждение фразы узла по голосам (единогласие).

    Фраза утверждена, когда ВСЕ члены узла проголосовали за один и тот же вариант.
    Утверждение НЕОБРАТИМО: на фразу сразу опираются соседи сверху (она им видна и
    они по ней переписывают тексты), поэтому переиграть её голосованием нельзя —
    остаётся только продавливание админом. Функция идемпотентна.
    """
    if node.approved_at is not None:
        return  # уже утверждено (голосованием или админом) — не пересматриваем

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
        return  # единогласия ещё нет — просто ждём

    option = await session.get(TaskStreamOption, unanimous_option)
    if option is None or option.deleted_at is not None:
        return
    node.phrase = option.text
    node.phrase_option_id = option.id
    node.approved_at = datetime.now(UTC)
    await session.flush()
    await close_node_room(session, node)


async def force_phrase(
    session: AsyncSession, node: TaskStreamNode, text: str, admin_id: int
) -> None:
    """Админ продавливает фразу узла (поток не должен зависать на несогласии)."""
    node.phrase = text
    node.phrase_option_id = None
    node.approved_at = datetime.now(UTC)
    node.approved_by = admin_id
    await session.flush()
    await close_node_room(session, node)


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


async def close_node_room(session: AsyncSession, node: TaskStreamNode) -> None:
    """Закрыть комнату подгруппы: этап пройден, обсуждать больше нечего.

    Снимаем строки `room_members` — у group-комнат нет ленивого доступа, поэтому без
    членства комната пропадает из списков и отдаёт 403 всем, включая админа
    (assert_room_access). Саму комнату и её сообщения НЕ трогаем: у rooms нет
    deleted_at, а на messages висят FK — история остаётся в базе, просто недостижима.
    `node.room_id` тоже оставляем: по нему ensure_node_room понимает, что комната для
    узла уже заводилась, и не создаёт её заново. Идемпотентно.
    """
    if node.room_id is None:
        return
    member_rows = await session.execute(
        select(RoomMember.user_id).where(RoomMember.room_id == node.room_id)
    )
    member_ids = list(member_rows.scalars().all())
    if not member_ids:
        return  # уже закрывали — второго события не шлём

    await session.execute(
        sa_delete(RoomMember).where(RoomMember.room_id == node.room_id)
    )
    await session.flush()

    event = ws_schemas.room_closed_event(node.room_id)
    for uid in member_ids:
        after_commit(session, _room_hook(uid, event))


def _room_hook(user_id: int, event: dict[str, object]) -> Callable[[], Awaitable[None]]:
    """Явная фабрика (не lambda в цикле) — иначе позднее связывание user_id."""

    async def _hook() -> None:
        await publish_user_event(user_id, event)

    return _hook


# --- продвижение по сетке -----------------------------------------------------


async def texts_by_user(
    session: AsyncSession, task_id: int
) -> dict[int, set[int]]:
    """{user_id: {сданные версии}} — источник всего выводимого состояния."""
    rows = await session.execute(
        select(TaskStreamText.user_id, TaskStreamText.version).where(
            TaskStreamText.task_id == task_id
        )
    )
    out: dict[int, set[int]] = {}
    for user_id, version in rows.all():
        out.setdefault(user_id, set()).add(version)
    return out


async def open_ready_node(
    session: AsyncSession, task: Task, stream: TaskStream, user_id: int, version: int
) -> None:
    """После сдачи текста: если узел, который его потребляет, собрал тексты от всех
    членов — завести ему комнату обсуждения.

    Это и есть «пара закончила → идёт дальше сразу»: комната появляется в момент
    готовности подгруппы, а не по общему переключателю.
    """
    if version >= stream.depth:
        return  # финальную версию не потребляет ни один узел
    my_nodes = await user_nodes(session, task.id, user_id)
    node_id = my_nodes.get(version + 1)
    if node_id is None:
        return
    node = await session.get(TaskStreamNode, node_id)
    if node is None or node.deleted_at is not None or node.room_id is not None:
        return
    members = await node_member_ids(session, node.id)
    texts = await texts_by_user(session, task.id)
    if node_ready(node.round, members, texts):
        await ensure_node_room(session, task, node, stream.depth)


async def assert_node_open_for_voting(
    session: AsyncSession, task_id: int, node: TaskStreamNode
) -> None:
    """Голосовать и предлагать варианты можно, только когда узел готов и не закрыт."""
    if node.approved_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Phrase already approved")
    members = await node_member_ids(session, node.id)
    texts = await texts_by_user(session, task_id)
    if not node_ready(node.round, members, texts):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Not everyone in this subgroup has submitted their text yet",
        )


async def build_stream_out(
    session: AsyncSession, task: Task, stream: TaskStream, viewer: User
) -> StreamOut:
    """Собрать состояние потока глазами `viewer` — одна ручка кормит всю канву.

    Всё состояние выводится здесь из сданных текстов и утверждённых фраз; чужие
    фразы и чужие тексты наружу не попадают (text_visible/phrase_visible, анти-IDOR).
    """
    is_admin = viewer.role == "admin"
    depth = stream.depth

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

    texts = await texts_by_user(session, task.id)
    approved = {n.id for n in nodes if n.approved_at is not None}
    children: dict[int, list[int]] = {}
    for node in nodes:
        if node.parent_id is not None:
            children.setdefault(node.parent_id, []).append(node.id)

    my_nodes = {
        n.round: n.id for n in nodes if viewer.id in members_by_node.get(n.id, [])
    }
    my_node_ids = set(my_nodes.values())
    ready_ids = {
        n.id
        for n in nodes
        if node_ready(n.round, members_by_node.get(n.id, []), texts)
    }

    everyone = await participant_ids(session, task.id)
    all_finals_in = bool(everyone) and all(
        depth in texts.get(uid, set()) for uid in everyone
    )

    out_nodes: list[StreamNodeOut] = []
    for node in nodes:
        member_ids = sorted(members_by_node.get(node.id, []))
        is_mine = node.id in my_node_ids
        visible = phrase_visible(
            node=node,
            depth=depth,
            is_admin=is_admin,
            in_node=is_mine,
            in_parent_node=node.parent_id in my_node_ids,
        )
        # «Кого ждём» — деталь внутренней кухни подгруппы, наружу не отдаём.
        pending = (
            sorted(
                uid
                for uid in member_ids
                if (node.round - 1) not in texts.get(uid, set())
            )
            if (is_mine or is_admin)
            else []
        )
        out_nodes.append(
            StreamNodeOut(
                id=node.id,
                round=node.round,
                position=node.position,
                side=node.side,
                parent_id=node.parent_id,
                member_ids=member_ids,
                label=node_label(len(member_ids), node.position, node.round == depth),
                phrase=node.phrase if visible else None,
                approved=node.approved_at is not None,
                approved_by_admin=node.approved_by is not None,
                # Комната живёт только до утверждения фразы (close_node_room), после
                # него ссылку не отдаём — она вела бы в 403.
                room_id=(
                    node.room_id
                    if (is_mine or is_admin) and node.approved_at is None
                    else None
                ),
                is_mine=is_mine,
                ready=node.id in ready_ids,
                pending_member_ids=pending,
                options=[],
                my_vote_option_id=None,
            )
        )

    my_version = current_version(depth, my_nodes, approved, children)
    # «Жду соседей» показываем, только когда свою часть человек уже сделал: пока он
    # не сдал текущую версию, мяч на его стороне и никакие узлы его не блокируют.
    my_submitted = my_version in texts.get(viewer.id, set())
    my_waiting = (
        waiting_on(depth, my_version, my_nodes, approved, children)
        if my_submitted
        else []
    )
    # Узел, где смотрящий сейчас голосует: следующий по его ветке, уже готовый.
    my_active_node_id = None
    if my_version < depth:
        candidate = my_nodes.get(my_version + 1)
        if candidate in ready_ids and candidate not in approved:
            my_active_node_id = candidate

    # Варианты и голоса грузим только туда, где смотрящий вправе их видеть.
    visible_option_nodes = (
        [n.id for n in nodes if n.id in ready_ids and n.id not in approved]
        if is_admin
        else ([my_active_node_id] if my_active_node_id is not None else [])
    )
    if visible_option_nodes:
        await _attach_options(session, out_nodes, visible_option_nodes, viewer.id)

    my_text = await session.scalar(
        select(TaskStreamText.body).where(
            TaskStreamText.task_id == task.id,
            TaskStreamText.user_id == viewer.id,
            TaskStreamText.version == my_version,
        )
    )

    participants = [
        StreamParticipantOut(
            user_id=uid,
            version=current_version(
                depth,
                {
                    n.round: n.id
                    for n in nodes
                    if uid in members_by_node.get(n.id, [])
                },
                approved,
                children,
            ),
            submitted_current=_submitted_current(
                uid, nodes, members_by_node, texts, approved, children, depth
            ),
            done=depth in texts.get(uid, set()),
        )
        for uid in everyone
    ]

    return StreamOut(
        depth=depth,
        finished=all_finals_in,
        deadline_at=task.deadline_at,
        nodes=out_nodes,
        participants=participants,
        my_version=my_version,
        my_current_text=my_text,
        my_waiting_on=my_waiting,
        my_active_node_id=my_active_node_id,
        pending_user_ids=(
            sorted(p.user_id for p in participants if not p.submitted_current)
            if is_admin
            else None
        ),
    )


def _submitted_current(
    user_id: int,
    nodes: list[TaskStreamNode],
    members_by_node: dict[int, list[int]],
    texts: dict[int, set[int]],
    approved: set[int],
    children: dict[int, list[int]],
    depth: int,
) -> bool:
    """Сдал ли участник ту версию, которую вправе писать прямо сейчас."""
    their_nodes = {
        n.round: n.id for n in nodes if user_id in members_by_node.get(n.id, [])
    }
    version = current_version(depth, their_nodes, approved, children)
    return version in texts.get(user_id, set())


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
