"""Тесты удаления группы целиком: права, каскад, разблокировка удаления юзера."""
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message, PinnedMessage
from app.models.room import Room, RoomMember
from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_owner_deletes_group(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")

    root = Message(room_id=room.id, sender_id=owner.id, content="root")
    session.add(root)
    await session.commit()
    await session.refresh(root)
    reply = Message(
        room_id=room.id, sender_id=member.id, content="reply", thread_root_id=root.id
    )
    session.add(reply)
    session.add(PinnedMessage(room_id=room.id, message_id=root.id, pinned_by=owner.id))
    await session.commit()

    resp = await client.delete(
        f"/api/rooms/{room.id}", headers=await _headers(client, owner)
    )
    assert resp.status_code == 204

    assert (await session.scalar(select(Room.id).where(Room.id == room.id))) is None
    assert (
        await session.scalar(select(Message).where(Message.room_id == room.id))
    ) is None
    assert (
        await session.scalar(
            select(RoomMember).where(RoomMember.room_id == room.id)
        )
    ) is None
    assert (
        await session.scalar(
            select(PinnedMessage).where(PinnedMessage.room_id == room.id)
        )
    ) is None


async def test_member_cannot_delete_group(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")

    resp = await client.delete(
        f"/api/rooms/{room.id}", headers=await _headers(client, member)
    )
    assert resp.status_code == 403


async def test_admin_deletes_group_not_member(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.delete(
        f"/api/rooms/{room.id}", headers=await _headers(client, admin)
    )
    assert resp.status_code == 204
    assert (await session.scalar(select(Room.id).where(Room.id == room.id))) is None


async def test_channel_and_dm_forbidden(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
) -> None:
    actor = await make_user(role="admin")
    headers = await _headers(client, actor)

    channel = await make_room(created_by=actor.id, type="channel", name="Chan")
    dm = await make_room(created_by=actor.id, type="dm", name=None)

    assert (await client.delete(f"/api/rooms/{channel.id}", headers=headers)).status_code == 400
    assert (await client.delete(f"/api/rooms/{dm.id}", headers=headers)).status_code == 400


async def test_deleting_group_unblocks_owner_deletion(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    """Регресс на исходную проблему: без групп-блокеров DELETE /admin/users проходит."""
    admin = await make_user(role="admin", password="adminpass123")
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    admin_tokens = await login(client, admin.username, "adminpass123")
    admin_headers = auth_headers(admin_tokens["access_token"])

    blocked = await client.delete(
        f"/api/admin/users/{owner.id}", headers=admin_headers
    )
    assert blocked.status_code == 409

    deleted_room = await client.delete(f"/api/rooms/{room.id}", headers=admin_headers)
    assert deleted_room.status_code == 204

    unblocked = await client.delete(
        f"/api/admin/users/{owner.id}", headers=admin_headers
    )
    assert unblocked.status_code == 204
    assert (await session.scalar(select(User.id).where(User.id == owner.id))) is None
