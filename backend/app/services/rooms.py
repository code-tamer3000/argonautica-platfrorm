"""Доступ к комнатам — единая точка для сообщений, тредов и статусов прочтения.

Авторизация на КАЖДОМ действии (CLAUDE.md п.1, IDOR — угроза №1): «состоит ли юзер
в комнате» зависит от типа. Для dm/group — есть ли строка `room_members`. Для канала
(вариант А, п.3) — он участник платформы; строку членства НЕ плодим, она появляется
лениво только под `last_read_message_id`.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room, RoomMember, RoomPlan
from app.models.task import TaskStreamNode
from app.models.user import User
from app.services.graduation import assert_not_graduated
from app.services.visibility import (
    can_message_admin,
    cohort_plan_ranks,
    contact_visible,
    diary_visible,
    intake_visible,
    is_cheap_tariff,
    plan_visible,
    user_rank,
)

NEWS_CHANNEL_NAME = "Новости"


async def load_room(session: AsyncSession, room_id: int) -> Room:
    """Комната существует, иначе 404."""
    room = await session.get(Room, room_id)
    if room is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Room not found")
    return room


async def is_stream_node_room(session: AsyncSession, room_id: int) -> bool:
    """Комната принадлежит узлу потока (task_stream_nodes.room_id).

    Нужна только для оверсайт-доступа админа: у group-комнат узлов нет строки членства
    для админа, поэтому решение «пускать ли» опирается на эту связь. Индекс
    ix_task_stream_nodes_room делает проверку точечной.
    """
    node_id = (
        await session.execute(
            select(TaskStreamNode.id).where(TaskStreamNode.room_id == room_id).limit(1)
        )
    ).scalar_one_or_none()
    return node_id is not None


async def assert_room_access(
    session: AsyncSession, room: Room, user: User
) -> RoomMember | None:
    """Проверить доступ юзера к комнате; вернуть строку членства, если она есть.

    dm/group: нет строки членства → 403. channel: доступ у любого участника
    платформы (вариант А) — вернуть существующую строку или None, НЕ создавая её.

    Исключение — комнаты подгрупп потока: платформенный админ входит туда для
    оверсайта (написать/подсмотреть обсуждение), хотя членом узла не является.
    Строку членства ему НЕ заводим — комната не всплывает в его общем списке чатов,
    вход только по кнопке на карточке узла (build_stream_out отдаёт админу room_id).

    Наблюдатель (is_observer) НЕ имеет доступа ни к одной комнате — включая каналы и
    новостной канал. Его разделы — только материалы (База знаний, Генные замки).

    Канал (включая новостной, ARG-104 — больше не singleton/кросс-поточный
    исключение) дополнительно гейтится двойным фильтром поток+тариф (ARG-96,
    docs/ROOMS.md): NULL/пусто — доступен всем, иначе только своему набору/
    перечисленным тарифам.

    Личный дневник — особый канал: виден не только владельцу («Все дневники»),
    поэтому чужой дневник дополнительно гейтится потоком владельца (`diary_visible`,
    ARG-112) — не через intake_id самой комнаты (та колонка у личных комнат
    намеренно всегда NULL), а прямым сравнением `intake_id` владельца и смотрящего.
    Тариф владельца по-прежнему НЕ учитывается для видимости по потоку (ARG-112) —
    кроме одного тарифа, у которого гейтится ОБЕ стороны отдельно: держатель самого
    дешёвого тарифа (`is_cheap_tariff`) как СМОТРЯЩИЙ не видит вообще ничьих дневников,
    кроме своего (ARG-114); как ВЛАДЕЛЕЦ его дневник не видит никто, кроме него самого
    и админов (ARG-117) — оба чека независимы друг от друга.
    """
    if user.is_observer:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Observer mode: chat is not available for you",
        )
    membership = await session.get(RoomMember, (room.id, user.id))
    if room.type == "channel":
        if user.role != "admin" and room.is_personal and room.created_by != user.id:
            owner = await session.get(User, room.created_by)
            if (
                owner is None
                or not diary_visible(owner, user)
                or await is_cheap_tariff(session, user)
                or await is_cheap_tariff(session, owner)
            ):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")
        elif user.role != "admin" and not room.is_personal:
            if not intake_visible(room.intake_id, user):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")
            if not await plan_visible(
                session, RoomPlan.plan_id, RoomPlan.room_id, room.id, user.plan_id
            ):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")
        return membership
    if membership is None:
        if (
            user.role == "admin"
            and room.type == "group"
            and await is_stream_node_room(session, room.id)
        ):
            return None
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this room")
    return membership


async def _dm_peer(session: AsyncSession, room: Room, user: User) -> User | None:
    """Второй участник dm-комнаты (не user). None, если состав странный (не dm)."""
    row = (
        await session.execute(
            select(RoomMember.user_id).where(
                RoomMember.room_id == room.id, RoomMember.user_id != user.id
            )
        )
    ).scalar_one_or_none()
    return await session.get(User, row) if row is not None else None


async def dm_write_allowed(session: AsyncSession, room: Room, user: User) -> bool:
    """Односторонний DM админ→игрок (ARG-110, часть B): в dm с НЕ-навигатор-админом
    писать может только участник с рангом тарифа в топ-2 потока (см. visibility.py
    `can_message_admin`) — иначе принять сообщение можно, ответить нельзя. Админ
    (в т.ч. навигатор) и любой dm без админа-собеседника не ограничены."""
    if room.type != "dm" or user.role == "admin":
        return True
    peer = await _dm_peer(session, room, user)
    if peer is None or peer.role != "admin" or peer.is_navigator:
        return True
    ranks = await cohort_plan_ranks(session, user.intake_id)
    return can_message_admin(user_rank(user, ranks), ranks)


async def assert_can_write(session: AsyncSession, room: Room, user: User) -> None:
    """Наблюдателю запись в любую комнату запрещена. Формально избыточно (он и на
    чтение комнату не проходит, см. assert_room_access) — оставлено как явный
    защитный барьер на пишущих путях (отправка/правка/удаление/закреп/typing).

    Выпускник (`graduated_at`) тем же барьером теряет запись во ВСЕЙ Рубке —
    личные чаты, дневник, каналы: история остаётся, новых сообщений нет
    (см. app/services/graduation.py).

    Односторонний dm с админом (ARG-110, часть B) — та же 403-граница, не только
    фронтовая маскировка композера (см. dm_write_allowed)."""
    if user.is_observer:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Observer mode: this section is read-only for you",
        )
    assert_not_graduated(user)
    if not await dm_write_allowed(session, room, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Cannot write to this admin — no reply permission for your tariff",
        )


async def assert_peer_visible(session: AsyncSession, current_user: User, peer: User) -> None:
    """Точечная проверка на POST /api/rooms (dm/group-invite, ARG-110, часть A):
    peer/приглашаемый должен входить в видимый для current_user круг — та же
    функция, что и GET /api/users/contacts (не дублируем правило). Admin
    неограничен (полный оверсайт, как везде в сервисе)."""
    if current_user.role == "admin":
        return
    ranks = await cohort_plan_ranks(session, current_user.intake_id)
    if not contact_visible(current_user, peer, ranks):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "User is outside your visible circle"
        )


def assert_can_pin(room: Room, user: User, membership: RoomMember | None) -> None:
    """Право закрепления (SPEC §4.7): owner комнаты / admin, с учётом типа комнаты.

    Вызывать ПОСЛЕ `assert_room_access` (членство уже проверено). platform-admin —
    всегда; group — только owner; dm — любой из двух участников (owner-роли нет, оба
    равны); канал и прочее для не-admin — 403.
    """
    if user.role == "admin":
        return
    if room.type == "group" and membership is not None and membership.role_in_room == "owner":
        return
    if room.type == "dm" and membership is not None:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to pin in this room")


async def ensure_news_channel(session: AsyncSession, intake_id: int) -> Room | None:
    """Гарантировать существование новостного канала данного потока (ARG-104).

    Один новостной канал на intake, не на всю платформу (было singleton до
    ARG-104, см. docs/DECISIONS.md). Создаётся лениво: нужен `created_by` =
    первый admin. Если админов ещё нет (совсем свежая БД) — пропускаем, создастся
    при следующем вызове после сидирования. Частичный уникальный индекс
    (uq_rooms_news_per_intake, `WHERE is_news` по `intake_id`) страхует от гонки
    blue/green — параллельный INSERT упадёт с IntegrityError, ловим.
    """
    existing = (
        await session.execute(
            select(Room).where(Room.is_news.is_(True), Room.intake_id == intake_id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    admin_id = (
        await session.execute(
            select(User.id).where(User.role == "admin").order_by(User.id).limit(1)
        )
    ).scalar_one_or_none()
    if admin_id is None:
        return None  # некому владеть — создадим на следующем старте

    room = Room(
        type="channel",
        name=NEWS_CHANNEL_NAME,
        is_news=True,
        intake_id=intake_id,
        created_by=admin_id,
    )
    session.add(room)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return (
            await session.execute(
                select(Room).where(Room.is_news.is_(True), Room.intake_id == intake_id)
            )
        ).scalar_one_or_none()
    return room


async def get_or_create_channel_membership(
    session: AsyncSession, room: Room, user: User
) -> RoomMember:
    """Ленивое членство в канале — только ради хранения last_read_message_id (п.3)."""
    membership = await session.get(RoomMember, (room.id, user.id))
    if membership is None:
        membership = RoomMember(
            room_id=room.id, user_id=user.id, role_in_room="member"
        )
        session.add(membership)
        await session.flush()
    return membership
