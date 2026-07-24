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

from app.models.room import Room, RoomMember
from app.models.task import TaskStreamNode
from app.models.user import User

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
    """
    if user.is_observer:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Observer mode: chat is not available for you",
        )
    membership = await session.get(RoomMember, (room.id, user.id))
    if room.type == "channel":
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


def assert_can_write(user: User) -> None:
    """Наблюдателю запись в любую комнату запрещена. Формально избыточно (он и на
    чтение комнату не проходит, см. assert_room_access) — оставлено как явный
    защитный барьер на пишущих путях (отправка/правка/удаление/закреп/typing)."""
    if user.is_observer:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Observer mode: this section is read-only for you",
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


async def ensure_news_channel(session: AsyncSession) -> Room | None:
    """Гарантировать существование единственного новостного канала.

    Создаётся лениво на старте: нужен `created_by` = первый admin. Если админов
    ещё нет (совсем свежая БД) — пропускаем, создастся при следующем старте после
    сидирования. Частичный уникальный индекс (uq_rooms_single_news) страхует от
    гонки blue/green — параллельный INSERT упадёт с IntegrityError, ловим.
    """
    existing = (
        await session.execute(select(Room).where(Room.is_news.is_(True)))
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
        created_by=admin_id,
    )
    session.add(room)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        return (
            await session.execute(select(Room).where(Room.is_news.is_(True)))
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
