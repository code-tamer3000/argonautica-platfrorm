"""Клуб «Факел» (ARG-54): ручной гейт `users.torch_unlocked` + членство в singleton-
group-комнате (`rooms.is_torch`). Тумблер — не самообслуживание участника, а
серверное действие админа (`app/api/admin.py`), поэтому grant/revoke живут здесь,
а не в общих add_member/remove_member (`app/api/rooms.py`) — та пара защищает
владельца/админа группы, но группу «Факел» участники не создают и не покидают сами.
"""
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room, RoomMember
from app.models.torch import TorchSettings
from app.models.user import User
from app.services.notifications import notify_torch_granted
from app.services.rooms import ensure_torch_room


async def get_or_create_torch_settings(session: AsyncSession) -> TorchSettings:
    """Единственная строка настроек (id=1) — общий текст заглушки."""
    settings = await session.get(TorchSettings, 1)
    if settings is None:
        settings = TorchSettings(id=1)
        session.add(settings)
        await session.flush()
    return settings


async def _club_rooms(session: AsyncSession) -> list[Room]:
    """Общие группы клуба: singleton `is_torch` (создаём лениво) + все с
    `torch_autojoin` (ARG-169, напр. «Пещера аргонавтов»)."""
    await ensure_torch_room(session)
    rows = await session.execute(
        select(Room).where(or_(Room.is_torch.is_(True), Room.torch_autojoin.is_(True)))
    )
    return list(rows.scalars().all())


async def grant_torch_access(session: AsyncSession, user: User) -> None:
    """Включить тумблер и добавить в комнату клуба (идемпотентно).

    Комната создаётся один раз при первом включении кому-либо — дальше это
    обычное группа-членство (см. docs/ROOMS.md). Уведомление (`torch_granted`)
    шлём только на реальном переходе false→true, тем же приёмом, что
    `notify_cabin_granted` — повторный (идемпотентный) вызов на уже открытого
    участника не должен спамить колокольчик.
    """
    was_unlocked = user.torch_unlocked
    user.torch_unlocked = True
    rooms = await _club_rooms(session)
    if not rooms:
        # Нет ни одного админа в БД — состояние, из которого включать тумблер
        # некому (сам вызов идёт из-под require_admin, так что практически
        # недостижимо; оставлено как явный guard, не молчаливый no-op).
        return
    for room in rooms:
        membership = await session.get(RoomMember, (room.id, user.id))
        if membership is None:
            session.add(RoomMember(room_id=room.id, user_id=user.id, role_in_room="member"))
    await session.flush()
    if not was_unlocked:
        await notify_torch_granted(session, user.id)


async def revoke_torch_access(session: AsyncSession, user: User) -> None:
    """Выключить тумблер и убрать из комнаты клуба (историю не трогаем)."""
    user.torch_unlocked = False
    for room in await _club_rooms(session):
        membership = await session.get(RoomMember, (room.id, user.id))
        if membership is not None:
            await session.delete(membership)
    await session.flush()
