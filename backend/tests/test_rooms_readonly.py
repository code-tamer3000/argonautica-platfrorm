"""Режим «только чтение» для group-чата (ARG-142): переключатель и write-gate."""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room
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


async def test_only_admin_can_toggle_readonly(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    # Владелец группы — не admin, флаг переключить не может.
    forbidden = await client.patch(
        f"/api/rooms/{room.id}/readonly",
        headers=await _headers(client, owner),
        json={"is_readonly": True},
    )
    assert forbidden.status_code == 403

    ok = await client.patch(
        f"/api/rooms/{room.id}/readonly",
        headers=await _headers(client, admin),
        json={"is_readonly": True},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["is_readonly"] is True


async def test_readonly_group_blocks_non_admin_writes(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, admin.id, "member")

    room_row = await session.get(Room, room.id)
    assert room_row is not None
    room_row.is_readonly = True
    await session.commit()

    forbidden = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, owner),
        json={"content": "нельзя"},
    )
    assert forbidden.status_code == 403

    allowed = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=await _headers(client, admin),
        json={"content": "можно"},
    )
    assert allowed.status_code == 201, allowed.text
