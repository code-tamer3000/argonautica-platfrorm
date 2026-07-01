"""Тесты управления участниками групп: права, идемпотентность, выход, гарды."""
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import RoomMember
from app.models.user import User

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _membership_count(
    session: AsyncSession, room_id: int, user_id: int
) -> int:
    # Аггрегат читает закоммиченное состояние БД, минуя identity-map сессии.
    return (
        await session.execute(
            select(func.count())
            .select_from(RoomMember)
            .where(RoomMember.room_id == room_id, RoomMember.user_id == user_id)
        )
    ).scalar_one()


async def test_member_cannot_add_others(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    target = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")

    resp = await client.post(
        f"/api/rooms/{room.id}/members",
        headers=await _headers(client, member),
        json={"user_id": target.id},
    )
    assert resp.status_code == 403


async def test_member_cannot_remove_others(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user()
    other = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")
    await add_membership(room.id, other.id, "member")

    resp = await client.delete(
        f"/api/rooms/{room.id}/members/{other.id}",
        headers=await _headers(client, member),
    )
    assert resp.status_code == 403


async def test_owner_adds_member_idempotent(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    target = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    first = await client.post(
        f"/api/rooms/{room.id}/members", headers=headers, json={"user_id": target.id}
    )
    assert first.status_code == 201
    assert first.json()["role_in_room"] == "member"

    # Повторное добавление — идемпотентно: 200 и ровно одна строка.
    again = await client.post(
        f"/api/rooms/{room.id}/members", headers=headers, json={"user_id": target.id}
    )
    assert again.status_code == 200
    assert await _membership_count(session, room.id, target.id) == 1


async def test_owner_removes_member(
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

    resp = await client.delete(
        f"/api/rooms/{room.id}/members/{member.id}",
        headers=await _headers(client, owner),
    )
    assert resp.status_code == 204
    assert await _membership_count(session, room.id, member.id) == 0


async def test_member_leaves_self(
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

    resp = await client.delete(
        f"/api/rooms/{room.id}/members/{member.id}",
        headers=await _headers(client, member),
    )
    assert resp.status_code == 204
    assert await _membership_count(session, room.id, member.id) == 0


async def test_sole_owner_cannot_leave(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.delete(
        f"/api/rooms/{room.id}/members/{owner.id}",
        headers=await _headers(client, owner),
    )
    assert resp.status_code == 409


async def test_two_owners_one_removes_other(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner1 = await make_user()
    owner2 = await make_user()
    room = await make_room(created_by=owner1.id)
    await add_membership(room.id, owner1.id, "owner")
    await add_membership(room.id, owner2.id, "owner")

    resp = await client.delete(
        f"/api/rooms/{room.id}/members/{owner2.id}",
        headers=await _headers(client, owner1),
    )
    assert resp.status_code == 204
    assert await _membership_count(session, room.id, owner2.id) == 0
    assert await _membership_count(session, room.id, owner1.id) == 1


async def test_channel_and_dm_forbidden(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
) -> None:
    actor = await make_user(role="admin")  # даже у admin — 400 по типу комнаты
    headers = await _headers(client, actor)
    target = await make_user()

    channel = await make_room(created_by=actor.id, type="channel", name="Chan")
    dm = await make_room(created_by=actor.id, type="dm", name=None)

    add_channel = await client.post(
        f"/api/rooms/{channel.id}/members", headers=headers, json={"user_id": target.id}
    )
    assert add_channel.status_code == 400

    add_dm = await client.post(
        f"/api/rooms/{dm.id}/members", headers=headers, json={"user_id": target.id}
    )
    assert add_dm.status_code == 400

    del_dm = await client.delete(
        f"/api/rooms/{dm.id}/members/{target.id}", headers=headers
    )
    assert del_dm.status_code == 400


async def test_admin_not_member_manages(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")  # platform-admin, НЕ состоит в группе
    target = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, admin)

    added = await client.post(
        f"/api/rooms/{room.id}/members", headers=headers, json={"user_id": target.id}
    )
    assert added.status_code == 201

    removed = await client.delete(
        f"/api/rooms/{room.id}/members/{target.id}", headers=headers
    )
    assert removed.status_code == 204
    assert await _membership_count(session, room.id, target.id) == 0


async def test_add_nonexistent_user(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.post(
        f"/api/rooms/{room.id}/members",
        headers=await _headers(client, owner),
        json={"user_id": 9_999_999},
    )
    assert resp.status_code == 404
