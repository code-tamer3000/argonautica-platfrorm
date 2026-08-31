"""Создание комнат, список комнат юзера и управление участниками групп.

Доступ проверяется на сервере на КАЖДОМ действии (CLAUDE.md п.1, IDOR — угроза №1).
Типы: dm (состав фиксирован, дедуп по dm_key), group (членство явное, есть owner),
channel (доступ неявный — вариант А: строк членства на всех не плодим, видны всем).
"""
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, delete, exists, func, or_, select, union, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.sql.selectable import CompoundSelect

from app.api.deps import get_current_active_user, require_admin
from app.db.session import get_session
from app.models.intake import Intake
from app.models.kb import KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.plan import Plan
from app.models.room import Room, RoomMember, RoomPlan
from app.models.sticker import Sticker
from app.models.task import TaskStreamNode
from app.models.user import User
from app.schemas.room import (
    AddMemberRequest,
    CreateRoomRequest,
    MemberOut,
    RoomOut,
    UpdateChannelRequest,
)
from app.services.rooms import (
    assert_peer_visible,
    assert_room_access,
    dm_write_allowed,
    load_room,
)
from app.services.visibility import (
    can_message_admin,
    cohort_plan_ranks,
    plan_visibility_clause,
    user_rank,
)

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


def _dm_key(a: int, b: int) -> str:
    """Канонический ключ пары для дедупа личных чатов: 'minId:maxId'."""
    lo, hi = sorted((a, b))
    return f"{lo}:{hi}"


async def _assert_intake_exists(session: AsyncSession, intake_id: int | None) -> None:
    if intake_id is None:
        return
    if await session.get(Intake, intake_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Intake not found")


async def _assert_plans_exist(session: AsyncSession, plan_ids: list[int]) -> None:
    if not plan_ids:
        return
    found = await session.execute(select(Plan.id).where(Plan.id.in_(plan_ids)))
    if set(found.scalars().all()) != set(plan_ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plan not found")


async def _set_room_plans(session: AsyncSession, room_id: int, plan_ids: list[int]) -> None:
    """Полностью заменить набор тарифов канала."""
    await session.execute(delete(RoomPlan).where(RoomPlan.room_id == room_id))
    for plan_id in dict.fromkeys(plan_ids):
        session.add(RoomPlan(room_id=room_id, plan_id=plan_id))


async def _room_plan_ids(session: AsyncSession, room_id: int) -> list[int]:
    rows = await session.execute(
        select(RoomPlan.plan_id).where(RoomPlan.room_id == room_id).order_by(RoomPlan.plan_id)
    )
    return list(rows.scalars().all())


def _room_out(room: Room, plan_ids: list[int]) -> RoomOut:
    out = RoomOut.model_validate(room)
    out.plan_ids = plan_ids
    return out


_ADMIN_OWNER_PLAN_ID = -1  # заведомо не существующий id тарифа — см. _owner_plan_label


def _owner_plan_label(
    plan_id: int | None, plan_name: str | None, role: str
) -> tuple[int | None, str | None]:
    """Ярлык владельца личного дневника для «Все дневники» (RoomOut.owner_plan_*),
    группируется на клиенте через `groupDiariesByPlan`/`groupByPlan`
    (`frontend/src/features/chat/util.ts`, `lib/planGroups.ts`).

    admin-владелец подписывается «Админ» вместо пустого/тарифного ярлыка — НЕ
    настоящий plan_id (у него обычно его и нет), sentinel-id нужен, чтобы
    `groupByPlan` завела для него отдельную секцию по `id`, а не свалила в
    «Без тарифа» (та группировка ключуется по id, а не по name)."""
    if role == "admin":
        return _ADMIN_OWNER_PLAN_ID, "Админ"
    return plan_id, plan_name


async def _create_dm(
    session: AsyncSession, current: User, peer_id: int | None, response: Response
) -> Room:
    if peer_id is None or peer_id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Valid peer_id required for dm")
    peer = await session.get(User, peer_id)
    if peer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Peer user not found")
    await assert_peer_visible(session, current, peer)

    dm_key = _dm_key(current.id, peer_id)
    existing = (
        await session.execute(select(Room).where(Room.dm_key == dm_key))
    ).scalar_one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK  # дедуп — не плодим
        return existing

    room = Room(type="dm", dm_key=dm_key, created_by=current.id)
    session.add(room)
    try:
        await session.flush()
    except IntegrityError:
        # Гонка: кто-то создал тот же dm параллельно — вернуть существующую.
        await session.rollback()
        existing = (
            await session.execute(select(Room).where(Room.dm_key == dm_key))
        ).scalar_one()
        response.status_code = status.HTTP_200_OK
        return existing

    session.add_all(
        [
            RoomMember(room_id=room.id, user_id=current.id, role_in_room="member"),
            RoomMember(room_id=room.id, user_id=peer_id, role_in_room="member"),
        ]
    )
    await session.flush()
    response.status_code = status.HTTP_201_CREATED
    return room


@router.post("", response_model=RoomOut)
async def create_room(
    body: CreateRoomRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> Room | RoomOut:
    """Создать комнату. Правила доступа зависят от типа (см. модуль)."""
    if body.type == "dm":
        return await _create_dm(session, current_user, body.peer_id, response)

    # group/channel требуют имя.
    if not body.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name is required")

    if body.type == "group":
        if not current_user.can_create_groups:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Not allowed to create groups"
            )
        room = Room(type="group", name=body.name, created_by=current_user.id)
        session.add(room)
        await session.flush()
        # Создатель группы — owner.
        session.add(
            RoomMember(room_id=room.id, user_id=current_user.id, role_in_room="owner")
        )
        await session.flush()
        response.status_code = status.HTTP_201_CREATED
        return room

    # channel — только admin; членских строк не создаём (вариант А).
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    await _assert_intake_exists(session, body.intake_id)
    await _assert_plans_exist(session, body.plan_ids)
    room = Room(
        type="channel", name=body.name, created_by=current_user.id, intake_id=body.intake_id
    )
    session.add(room)
    await session.flush()
    await _set_room_plans(session, room.id, body.plan_ids)
    await session.flush()
    response.status_code = status.HTTP_201_CREATED
    return _room_out(room, await _room_plan_ids(session, room.id))


@router.get("/personal", response_model=RoomOut)
async def get_personal_channel(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Room:
    """Вернуть личный канал текущего пользователя."""
    # Наблюдателю чат недоступен целиком (в т.ч. свой личный канал/Динамика).
    if current_user.is_observer:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Observer mode: chat is not available for you"
        )
    room = (
        await session.execute(
            select(Room).where(
                Room.is_personal.is_(True),
                Room.created_by == current_user.id,
            )
        )
    ).scalar_one_or_none()
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Personal channel not found")
    return room


@router.get("", response_model=list[RoomOut])
async def list_rooms(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[RoomOut]:
    """Комнаты юзера: его dm/группы (по членству) + все каналы (видны всем, вариант А).

    На каждую комнату — счётчик непрочитанных: живые чужие сообщения с
    id > last_read_message_id (статусы прочтения, CLAUDE.md п.4).
    """
    # Наблюдатель (is_observer): пассивный доступ «только к материалам». Чат ему
    # недоступен целиком — ни dm/группы, ни каналы, ни новости. Возвращаем пусто.
    if current_user.is_observer:
        return []

    member_rooms = select(RoomMember.room_id).where(
        RoomMember.user_id == current_user.id
    )
    # Каналы: admin видит все; участник — с двойным фильтром поток+тариф (ARG-96),
    # новостной канал больше не исключение (ARG-104) — гейтится тем же правилом,
    # что обычный канал. Личный дневник — особый случай («Все дневники» показывает
    # и чужие): свой виден всегда, чужой — каскадно по рангу тарифа владельца
    # (сравниваем пользователей напрямую, не intake_id самой комнаты — та колонка у
    # личных комнат намеренно всегда NULL, см. diary_visible/ARG-110).
    ranks: dict[int, int] = {}
    if current_user.role == "admin":
        channel_clause = Room.type == "channel"
    else:
        ranks = await cohort_plan_ranks(session, current_user.intake_id)
        # Каскад по рангу тарифа (ARG-110): видны тарифы с рангом <= своему. NULL
        # (нет тарифа) — ранг 0, отдельная ветка ниже (visible_plan_ids его не несёт).
        visible_plan_ids = [
            plan_id
            for plan_id, rank in ranks.items()
            if rank <= user_rank(current_user, ranks)
        ]
        Owner = aliased(User)
        own_personal = and_(
            Room.is_personal.is_(True), Room.created_by == current_user.id
        )
        others_personal_visible = and_(
            Room.is_personal.is_(True),
            Room.created_by != current_user.id,
            exists().where(
                Owner.id == Room.created_by,
                Owner.role != "admin",
                Owner.intake_id.is_not_distinct_from(current_user.intake_id),
                or_(Owner.plan_id.is_(None), Owner.plan_id.in_(visible_plan_ids)),
            ),
        )
        regular_channel_visible = and_(
            Room.is_personal.is_(False),
            or_(
                Room.intake_id.is_(None),
                Room.intake_id == current_user.intake_id,
            ),
            plan_visibility_clause(
                RoomPlan.plan_id, RoomPlan.room_id, Room.id, current_user.plan_id
            ),
        )
        channel_clause = and_(
            Room.type == "channel",
            or_(
                own_personal,
                others_personal_visible,
                regular_channel_visible,
            ),
        )
    result = await session.execute(
        select(Room)
        .where(or_(channel_clause, Room.id.in_(member_rooms)))
        .order_by(Room.created_at)
    )
    rooms = list(result.scalars().all())
    if not rooms:
        return []

    # Непрочитанные по всем комнатам одним запросом (без N+1). LEFT JOIN на членство
    # текущего юзера: для каналов без строки last_read = NULL → считается от 0.
    room_ids = [room.id for room in rooms]
    unread_rows = await session.execute(
        select(Message.room_id, func.count())
        .select_from(Message)
        .outerjoin(
            RoomMember,
            (RoomMember.room_id == Message.room_id)
            & (RoomMember.user_id == current_user.id),
        )
        .where(
            Message.room_id.in_(room_ids),
            Message.deleted_at.is_(None),
            Message.sender_id != current_user.id,
            Message.id > func.coalesce(RoomMember.last_read_message_id, 0),
        )
        .group_by(Message.room_id)
    )
    unread: dict[int, int] = {
        room_id: count for room_id, count in unread_rows.all()
    }

    # peer_id для dm-комнат — одним батч-запросом вместо N+1.
    dm_room_ids = [r.id for r in rooms if r.type == "dm"]
    dm_peer_map: dict[int, int] = {}
    if dm_room_ids:
        peer_rows = await session.execute(
            select(RoomMember.room_id, RoomMember.user_id).where(
                RoomMember.room_id.in_(dm_room_ids),
                RoomMember.user_id != current_user.id,
            )
        )
        dm_peer_map = {rid: uid for rid, uid in peer_rows.all()}

    # Одностороннее ограничение записи в dm с админом (ARG-110, часть B): пир —
    # НЕ-навигатор-админ и у смотрящего нет рангового права ему писать. Админ
    # сам никогда не блокируется (dm_peer_map тут ни при чём для него).
    dm_write_locked: dict[int, bool] = {}
    if current_user.role != "admin" and dm_peer_map:
        peer_admins = (
            await session.execute(
                select(User.id, User.is_navigator).where(
                    User.id.in_(set(dm_peer_map.values())), User.role == "admin"
                )
            )
        ).all()
        admin_navigator_map = {uid: nav for uid, nav in peer_admins}
        for room_id, peer_id in dm_peer_map.items():
            is_navigator = admin_navigator_map.get(peer_id)
            if is_navigator is False:
                dm_write_locked[room_id] = not can_message_admin(
                    user_rank(current_user, ranks), ranks
                )

    # Комнаты подгрупп потока — тоже батчем: клиент вешает на них виджет голосования.
    node_rows = await session.execute(
        select(
            TaskStreamNode.room_id, TaskStreamNode.id, TaskStreamNode.task_id
        ).where(
            TaskStreamNode.room_id.in_(room_ids),
            TaskStreamNode.deleted_at.is_(None),
        )
    )
    stream_map: dict[int, tuple[int, int]] = {
        room_id: (node_id, task_id) for room_id, node_id, task_id in node_rows.all()
    }

    # Тариф владельца личного дневника — батчем, чтобы «Все дневники» группировались
    # по тарифу на клиенте без похода в admin-only /api/admin/users (см. RoomOut).
    owner_ids = {r.created_by for r in rooms if r.is_personal}
    owner_plan_map: dict[int, tuple[int | None, str | None]] = {}
    if owner_ids:
        owner_rows = await session.execute(
            select(User.id, User.plan_id, Plan.name, User.role)
            .outerjoin(Plan, Plan.id == User.plan_id)
            .where(User.id.in_(owner_ids))
        )
        owner_plan_map = {
            uid: _owner_plan_label(plan_id, plan_name, role)
            for uid, plan_id, plan_name, role in owner_rows.all()
        }

    out: list[RoomOut] = []
    for room in rooms:
        item = RoomOut.model_validate(room)
        item.unread_count = unread.get(room.id, 0)
        if room.type == "dm":
            item.peer_id = dm_peer_map.get(room.id)
            item.dm_write_locked = dm_write_locked.get(room.id, False)
        node = stream_map.get(room.id)
        if node is not None:
            item.stream_node_id, item.stream_task_id = node
        if room.is_personal:
            item.owner_plan_id, item.owner_plan_name = owner_plan_map.get(
                room.created_by, (None, None)
            )
        out.append(item)
    return out


@router.get("/{room_id}", response_model=RoomOut)
async def get_room(
    room_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RoomOut:
    """Одна комната по id — для случаев, когда её нет в списке `GET /rooms`.

    Нужна админу для оверсайт-входа в комнату подгруппы потока: членства у него нет,
    поэтому комната не приходит в общий список, но `assert_room_access` его туда
    пускает (см. services/rooms), а клиенту нужны метаданные (название, stream-виджет).
    Доступ — та же единая проверка, что и на чтение ленты; строку членства не заводим.
    """
    room = await load_room(session, room_id)
    membership = await assert_room_access(session, room, current_user)

    plan_ids = await _room_plan_ids(session, room.id) if room.type == "channel" else []
    item = _room_out(room, plan_ids)
    if room.is_personal:
        owner_row = await session.execute(
            select(User.plan_id, Plan.name, User.role)
            .outerjoin(Plan, Plan.id == User.plan_id)
            .where(User.id == room.created_by)
        )
        owner = owner_row.first()
        if owner is not None:
            item.owner_plan_id, item.owner_plan_name = _owner_plan_label(*owner)
    last_read = (membership.last_read_message_id or 0) if membership else 0
    unread_result = await session.execute(
        select(func.count())
        .select_from(Message)
        .where(
            Message.room_id == room.id,
            Message.deleted_at.is_(None),
            Message.sender_id != current_user.id,
            Message.id > last_read,
        )
    )
    item.unread_count = unread_result.scalar_one()

    if room.type == "dm":
        peer_row = await session.execute(
            select(RoomMember.user_id).where(
                RoomMember.room_id == room.id,
                RoomMember.user_id != current_user.id,
            )
        )
        item.peer_id = peer_row.scalar_one_or_none()
        item.dm_write_locked = not await dm_write_allowed(session, room, current_user)

    node_row = await session.execute(
        select(TaskStreamNode.id, TaskStreamNode.task_id).where(
            TaskStreamNode.room_id == room.id,
            TaskStreamNode.deleted_at.is_(None),
        )
    )
    node = node_row.first()
    if node is not None:
        item.stream_node_id, item.stream_task_id = node
    return item


@router.patch("/{room_id}", response_model=RoomOut)
async def update_channel(
    room_id: int,
    body: UpdateChannelRequest,
    current_admin: Annotated[User, Depends(require_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> RoomOut:
    """Править канал: название, привязка к потоку/тарифам (ARG-96). Только channel."""
    room = await load_room(session, room_id)
    if room.type != "channel" or room.is_personal or room.is_news:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only regular channels can be edited this way"
        )

    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"]:
        room.name = changes["name"]
    if "intake_id" in changes:
        await _assert_intake_exists(session, changes["intake_id"])
        room.intake_id = changes["intake_id"]
    if "plan_ids" in changes and changes["plan_ids"] is not None:
        await _assert_plans_exist(session, changes["plan_ids"])
        await _set_room_plans(session, room.id, changes["plan_ids"])
    await session.flush()

    return _room_out(room, await _room_plan_ids(session, room.id))


async def _load_group(session: AsyncSession, room_id: int) -> Room:
    """Комната существует и это группа, иначе 404/400 (так же режем канал/dm)."""
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    if room.type != "group":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Member management is only available for groups",
        )
    return room


async def _is_room_owner(session: AsyncSession, room_id: int, user_id: int) -> bool:
    membership = await session.get(RoomMember, (room_id, user_id))
    return membership is not None and membership.role_in_room == "owner"


async def _count_owners(session: AsyncSession, room_id: int) -> int:
    result = await session.execute(
        select(func.count())
        .select_from(RoomMember)
        .where(RoomMember.room_id == room_id, RoomMember.role_in_room == "owner")
    )
    return result.scalar_one()


@router.get("/{room_id}/members", response_model=list[MemberOut])
async def list_members(
    room_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[RoomMember]:
    """Список участников группы. Доступ — только своим участникам/admin (п.1)."""
    await _load_group(session, room_id)

    is_member = await session.get(RoomMember, (room_id, current_user.id)) is not None
    if not is_member and current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")

    result = await session.execute(
        select(RoomMember)
        .where(RoomMember.room_id == room_id)
        .order_by(RoomMember.joined_at)
    )
    return list(result.scalars().all())


@router.post("/{room_id}/members", response_model=MemberOut)
async def add_member(
    room_id: int,
    body: AddMemberRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> RoomMember:
    """Добавить участника. Можно owner группы или platform-admin. Идемпотентно."""
    await _load_group(session, room_id)

    is_admin = current_user.role == "admin"
    if not is_admin and not await _is_room_owner(session, room_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner or admin required")

    target = await session.get(User, body.user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    await assert_peer_visible(session, current_user, target)

    existing = await session.get(RoomMember, (room_id, body.user_id))
    if existing is not None:
        response.status_code = status.HTTP_200_OK  # уже участник — не дублим
        return existing

    membership = RoomMember(
        room_id=room_id, user_id=body.user_id, role_in_room="member"
    )
    session.add(membership)
    await session.flush()
    await session.refresh(membership)
    response.status_code = status.HTTP_201_CREATED
    return membership


@router.delete("/{room_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    room_id: int,
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить участника (owner/admin) или выйти самому (любой участник)."""
    await _load_group(session, room_id)

    is_self = user_id == current_user.id
    if not is_self:
        is_admin = current_user.role == "admin"
        if not is_admin and not await _is_room_owner(session, room_id, current_user.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner or admin required")

    membership = await session.get(RoomMember, (room_id, user_id))
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User is not a member")

    # Нельзя удалить единственного owner'а — иначе группа осиротеет.
    # Передача владения — отдельной фичей позже.
    if (
        membership.role_in_room == "owner"
        and await _count_owners(session, room_id) == 1
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot remove the sole owner; transfer ownership first",
        )

    await session.delete(membership)
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить группу целиком (owner или platform-admin). Каскадно, в одной транзакции.

    Только для type == 'group' — dm и каналы этим путём не удаляются.
    """
    await _load_group(session, room_id)

    is_admin = current_user.role == "admin"
    if not is_admin and not await _is_room_owner(session, room_id, current_user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Owner or admin required")

    msg_ids = list(
        (
            await session.execute(select(Message.id).where(Message.room_id == room_id))
        )
        .scalars()
        .all()
    )

    media_ids: list[int] = []
    if msg_ids:
        media_ids = list(
            (
                await session.execute(
                    select(MessageAttachment.media_asset_id).where(
                        MessageAttachment.message_id.in_(msg_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        await session.execute(
            delete(MessageAttachment).where(MessageAttachment.message_id.in_(msg_ids))
        )
        await session.execute(
            delete(PinnedMessage).where(PinnedMessage.message_id.in_(msg_ids))
        )
        # Ответы в тредах на корни этой комнаты — «отвязываем» (правило плоскости тредов).
        await session.execute(
            update(Message)
            .where(Message.thread_root_id.in_(msg_ids))
            .values(thread_root_id=None)
        )

    await session.execute(delete(PinnedMessage).where(PinnedMessage.room_id == room_id))
    await session.execute(delete(RoomMember).where(RoomMember.room_id == room_id))
    await session.execute(delete(Message).where(Message.room_id == room_id))
    await session.execute(delete(Room).where(Room.id == room_id))

    # Медиа, привязанные к сообщениям комнаты, но больше никем не используемые.
    if media_ids:
        referenced: CompoundSelect[tuple[Any]] = union(
            select(MessageAttachment.media_asset_id),
            select(KbItemMedia.media_asset_id),
            select(Sticker.image_media_id).where(Sticker.image_media_id.isnot(None)),
            select(User.avatar_media_id).where(User.avatar_media_id.isnot(None)),
        )
        await session.execute(
            delete(MediaAsset).where(
                MediaAsset.id.in_(media_ids),
                MediaAsset.id.notin_(referenced.scalar_subquery()),
            )
        )

    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
