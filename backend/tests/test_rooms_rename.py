"""Переименование группы (`PATCH /api/rooms/{id}/name`, ARG-162): владелец группы
или platform-admin, та же проверка прав, что у обложки (ARG-154). Валидация имени
(strip/непустое/лимит длины) переиспользуется и в `POST /api/rooms`."""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room
from app.models.user import User

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_owner_renames_group(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, owner),
        json={"name": "Новое имя"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Новое имя"

    # Приходит и в списке комнат.
    listed = await client.get("/api/rooms", headers=await _headers(client, owner))
    room_out = next(r for r in listed.json() if r["id"] == room.id)
    assert room_out["name"] == "Новое имя"


async def test_platform_admin_renames_group_without_membership(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, admin),
        json={"name": "Переименовано админом"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "Переименовано админом"


async def test_regular_member_cannot_rename_group(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    member = await make_user(intake_id=owner.intake_id)
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, member.id, "member")

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, member),
        json={"name": "Самозахват"},
    )
    assert resp.status_code == 403


async def test_cannot_rename_channel_via_group_endpoint(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    room = Room(type="channel", name="Канал", created_by=owner.id)
    session.add(room)
    await session.commit()
    await session.refresh(room)

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, owner),
        json={"name": "Новое имя канала"},
    )
    assert resp.status_code == 400


async def test_cannot_rename_dm(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    user_a = await make_user()
    user_b = await make_user(intake_id=user_a.intake_id)
    room = await make_room(created_by=user_a.id, type="dm")
    await add_membership(room.id, user_a.id, "member")
    await add_membership(room.id, user_b.id, "member")

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, user_a),
        json={"name": "У DM нет имени"},
    )
    assert resp.status_code == 400


async def test_empty_or_whitespace_name_rejected(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    empty = await client.patch(
        f"/api/rooms/{room.id}/name", headers=headers, json={"name": ""}
    )
    assert empty.status_code == 400

    whitespace = await client.patch(
        f"/api/rooms/{room.id}/name", headers=headers, json={"name": "   "}
    )
    assert whitespace.status_code == 400


async def test_name_over_length_limit_rejected(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, owner),
        json={"name": "а" * 101},
    )
    assert resp.status_code == 400


async def test_name_is_trimmed(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    resp = await client.patch(
        f"/api/rooms/{room.id}/name",
        headers=await _headers(client, owner),
        json={"name": "  С пробелами  "},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "С пробелами"


async def test_create_group_rejects_whitespace_only_name(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    owner = await make_user(can_create_groups=True)
    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, owner),
        json={"type": "group", "name": "   "},
    )
    assert resp.status_code == 400


async def test_create_group_rejects_over_length_name(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    owner = await make_user(can_create_groups=True)
    resp = await client.post(
        "/api/rooms",
        headers=await _headers(client, owner),
        json={"type": "group", "name": "а" * 101},
    )
    assert resp.status_code == 400
