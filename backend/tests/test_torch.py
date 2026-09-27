"""Клуб «Факел» (ARG-54): ручной гейт torch_unlocked + singleton-комната.

Тесты бегут без lifespan (см. conftest.py) — комната клуба создаётся лениво
первым же `grant_torch_access` (через `POST /admin/torch/grant`), не заранее.
"""
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.room import Room, RoomMember
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_non_graduated_has_no_torch_access(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Не выпустившийся: тумблер по умолчанию false, заглушка недоступна."""
    user = await make_user()
    assert user.torch_unlocked is False

    me = await client.get("/api/auth/me", headers=await _headers(client, user))
    assert me.json()["torch_unlocked"] is False

    stub = await client.get("/api/torch/stub", headers=await _headers(client, user))
    assert stub.status_code == 403


async def test_graduated_without_toggle_sees_stub_no_room(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Выпустился, тумблер ещё не включён: видит заглушку, в комнату не попадает."""
    await make_user(role="admin")  # нужен хоть один админ — ensure_torch_room
    user = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, user)

    stub = await client.get("/api/torch/stub", headers=headers)
    assert stub.status_code == 200, stub.text
    assert stub.json()["stub_text"]


async def test_admin_grant_unlocks_toggle_and_room_access(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    grant = await client.post(
        "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
    )
    assert grant.status_code == 204, grant.text

    await session.refresh(user)
    assert user.torch_unlocked is True

    room = (await session.execute(select(Room).where(Room.is_torch.is_(True)))).scalar_one()
    membership = await session.get(RoomMember, (room.id, user.id))
    assert membership is not None

    # Может писать — выпуск не блокирует запись именно в этой комнате.
    send = await client.post(
        f"/api/rooms/{room.id}/messages", headers=user_h, json={"content": "привет, клуб"}
    )
    assert send.status_code == 201, send.text

    rooms = await client.get("/api/rooms", headers=user_h)
    assert any(r["id"] == room.id for r in rooms.json())


async def test_admin_revoke_locks_toggle_and_removes_membership(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    await client.post(
        "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
    )
    room = (await session.execute(select(Room).where(Room.is_torch.is_(True)))).scalar_one()

    revoke = await client.delete(f"/api/admin/torch/grant/{user.id}", headers=admin_h)
    assert revoke.status_code == 204, revoke.text

    await session.refresh(user)
    assert user.torch_unlocked is False
    assert await session.get(RoomMember, (room.id, user.id)) is None

    # Запись закрыта — та же 403-граница, что у любой не-членской комнаты.
    send = await client.post(
        f"/api/rooms/{room.id}/messages", headers=user_h, json={"content": "ещё раз"}
    )
    assert send.status_code == 403

    stub = await client.get("/api/torch/stub", headers=user_h)
    assert stub.status_code == 200  # заглушка снова доступна


async def test_grant_is_idempotent(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user(graduated_at=datetime.now(UTC))
    admin_h = await _headers(client, admin)

    for _ in range(2):
        resp = await client.post(
            "/api/admin/torch/grant", headers=admin_h, json={"user_ids": [user.id]}
        )
        assert resp.status_code == 204, resp.text

    room = (await session.execute(select(Room).where(Room.is_torch.is_(True)))).scalar_one()
    count = (
        await session.execute(
            select(RoomMember).where(
                RoomMember.room_id == room.id, RoomMember.user_id == user.id
            )
        )
    ).scalars().all()
    assert len(count) == 1


async def test_grant_skips_non_graduated_and_admins(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    other_admin = await make_user(role="admin")
    not_graduated = await make_user()
    admin_h = await _headers(client, admin)

    resp = await client.post(
        "/api/admin/torch/grant",
        headers=admin_h,
        json={"user_ids": [not_graduated.id, other_admin.id]},
    )
    assert resp.status_code == 204, resp.text

    await session.refresh(not_graduated)
    await session.refresh(other_admin)
    assert not_graduated.torch_unlocked is False
    assert other_admin.torch_unlocked is False


async def test_admin_overview_lists_only_graduates(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    graduate = await make_user(graduated_at=datetime.now(UTC), display_name="Выпускник")
    await make_user(display_name="Не выпустился")
    admin_h = await _headers(client, admin)

    resp = await client.get("/api/admin/torch", headers=admin_h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = {r["user_id"] for r in body["rows"]}
    assert graduate.id in ids
    assert len(body["rows"]) == 1
    assert body["stub_text"]


async def test_admin_can_update_stub_text(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    resp = await client.patch(
        "/api/admin/torch/stub", headers=admin_h, json={"stub_text": "Скоро откроется"}
    )
    assert resp.status_code == 204, resp.text

    overview = await client.get("/api/admin/torch", headers=admin_h)
    assert overview.json()["stub_text"] == "Скоро откроется"


async def test_non_admin_cannot_manage_torch(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, user)

    assert (await client.get("/api/admin/torch", headers=headers)).status_code == 403
    assert (
        await client.post(
            "/api/admin/torch/grant", headers=headers, json={"user_ids": [user.id]}
        )
    ).status_code == 403
