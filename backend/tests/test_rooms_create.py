"""Тесты создания и доступа к комнатам: dm-дедуп, права group/channel, список."""
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room, RoomMember
from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_dm_dedup(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    a = await make_user()
    b = await make_user()
    ha = await _headers(client, a)
    hb = await _headers(client, b)

    first = await client.post("/api/rooms", headers=ha, json={"type": "dm", "peer_id": b.id})
    assert first.status_code == 201
    room_id = first.json()["id"]

    # Повторно тем же юзером — дедуп, 200, та же комната.
    again = await client.post("/api/rooms", headers=ha, json={"type": "dm", "peer_id": b.id})
    assert again.status_code == 200
    assert again.json()["id"] == room_id

    # С другой стороны (B→A) — канонический ключ даёт ту же комнату.
    reverse = await client.post("/api/rooms", headers=hb, json={"type": "dm", "peer_id": a.id})
    assert reverse.status_code == 200
    assert reverse.json()["id"] == room_id

    count = (
        await session.execute(
            select(func.count()).select_from(Room).where(Room.id == room_id)
        )
    ).scalar_one()
    assert count == 1


async def test_dm_with_self_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    a = await make_user()
    resp = await client.post(
        "/api/rooms", headers=await _headers(client, a), json={"type": "dm", "peer_id": a.id}
    )
    assert resp.status_code == 400


async def test_group_forbidden_without_permission(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(can_create_groups=False)
    resp = await client.post(
        "/api/rooms", headers=await _headers(client, user), json={"type": "group", "name": "G"}
    )
    assert resp.status_code == 403


async def test_group_created_with_owner(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    user = await make_user()  # can_create_groups=True по умолчанию
    resp = await client.post(
        "/api/rooms", headers=await _headers(client, user), json={"type": "group", "name": "G"}
    )
    assert resp.status_code == 201
    room_id = resp.json()["id"]
    membership = await session.get(RoomMember, (room_id, user.id))
    assert membership is not None and membership.role_in_room == "owner"


async def test_channel_forbidden_for_non_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant")
    resp = await client.post(
        "/api/rooms", headers=await _headers(client, user), json={"type": "channel", "name": "C"}
    )
    assert resp.status_code == 403


async def test_admin_creates_channel(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, admin),
        json={"type": "channel", "name": "News"},
    )
    assert resp.status_code == 201
    room_id = resp.json()["id"]
    # Вариант А: членских строк у канала нет.
    members = (
        await session.execute(
            select(func.count())
            .select_from(RoomMember)
            .where(RoomMember.room_id == room_id)
        )
    ).scalar_one()
    assert members == 0


async def test_list_rooms_visibility(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    other = await make_user()

    # У user: dm с other и собственная группа.
    dm = await client.post(
        "/api/rooms", headers=await _headers(client, user), json={"type": "dm", "peer_id": other.id}
    )
    dm_id = dm.json()["id"]
    group = await client.post(
        "/api/rooms", headers=await _headers(client, user), json={"type": "group", "name": "Mine"}
    )
    group_id = group.json()["id"]

    # Канал от админа (виден всем) и чужая группа (где user не состоит).
    channel = await client.post(
        "/api/rooms", headers=await _headers(client, admin), json={"type": "channel", "name": "Pub"}
    )
    channel_id = channel.json()["id"]
    foreign = await make_room(created_by=other.id, name="Foreign")
    await add_membership(foreign.id, other.id, "owner")

    listing = await client.get("/api/rooms", headers=await _headers(client, user))
    assert listing.status_code == 200
    ids = {r["id"] for r in listing.json()}
    assert {dm_id, group_id, channel_id} <= ids   # свои dm/группа + видимый канал
    assert foreign.id not in ids                   # чужая группа — не видна


async def test_admin_patch_can_create_groups(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    # Админ отнимает право — создание группы запрещено.
    off = await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"can_create_groups": False}
    )
    assert off.status_code == 200 and off.json()["can_create_groups"] is False
    denied = await client.post("/api/rooms", headers=user_h, json={"type": "group", "name": "G"})
    assert denied.status_code == 403

    # Возвращает право — создание группы снова доступно.
    on = await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"can_create_groups": True}
    )
    assert on.status_code == 200 and on.json()["can_create_groups"] is True
    allowed = await client.post("/api/rooms", headers=user_h, json={"type": "group", "name": "G"})
    assert allowed.status_code == 201


async def test_non_admin_cannot_patch_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    target = await make_user()
    resp = await client.patch(
        f"/api/admin/users/{target.id}",
        headers=await _headers(client, user),
        json={"can_create_groups": False},
    )
    assert resp.status_code == 403
