"""Тесты закреплений (pins, SPEC §4.7): право owner/admin (для dm — любой участник),
идемпотентность, список для участников, целостность при удалении сообщения."""
from httpx import AsyncClient

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


async def _send(
    client: AsyncClient, headers: dict[str, str], room_id: int, **body: object
) -> dict:
    resp = await client.post(
        f"/api/rooms/{room_id}/messages", headers=headers, json=body
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _pins(client: AsyncClient, headers: dict[str, str], room_id: int) -> list[dict]:
    resp = await client.get(f"/api/rooms/{room_id}/pins", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_owner_pins_unpins_and_lists(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="pin me")

    pinned = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert pinned.status_code == 201, pinned.text
    body = pinned.json()
    assert body["message_id"] == msg["id"]
    assert body["pinned_by"] == owner.id
    assert body["message"]["content"] == "pin me"

    listed = await _pins(client, headers, room.id)
    assert [p["message_id"] for p in listed] == [msg["id"]]

    unpinned = await client.delete(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert unpinned.status_code == 204
    assert await _pins(client, headers, room.id) == []


async def test_member_cannot_pin_but_sees_list(
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
    owner_headers = await _headers(client, owner)
    member_headers = await _headers(client, member)

    msg = await _send(client, owner_headers, room.id, content="m")

    # Обычный участник группы пинить НЕ может.
    forbidden = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=member_headers
    )
    assert forbidden.status_code == 403

    # Но видит закрепления, сделанные owner'ом.
    await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=owner_headers
    )
    listed = await _pins(client, member_headers, room.id)
    assert [p["message_id"] for p in listed] == [msg["id"]]


async def test_admin_can_pin_in_channel(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
) -> None:
    admin = await make_user(role="admin")
    reader = await make_user()
    channel = await make_room(created_by=admin.id, type="channel", name="Chan")
    admin_headers = await _headers(client, admin)

    msg = await _send(client, admin_headers, channel.id, content="announce")

    # Не-admin участник канала пинить не может (вариант А: доступ есть, право — нет).
    forbidden = await client.post(
        f"/api/rooms/{channel.id}/messages/{msg['id']}/pin",
        headers=await _headers(client, reader),
    )
    assert forbidden.status_code == 403

    pinned = await client.post(
        f"/api/rooms/{channel.id}/messages/{msg['id']}/pin", headers=admin_headers
    )
    assert pinned.status_code == 201

    # Участник канала видит закрепление.
    listed = await _pins(client, await _headers(client, reader), channel.id)
    assert [p["message_id"] for p in listed] == [msg["id"]]


async def test_pin_is_idempotent(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="m")

    first = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert first.status_code == 201
    again = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert again.status_code == 200  # уже закреплено — не дублим
    assert len(await _pins(client, headers, room.id)) == 1


async def test_pin_missing_or_deleted_message(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    missing = await client.post(
        f"/api/rooms/{room.id}/messages/999999/pin", headers=headers
    )
    assert missing.status_code == 404

    msg = await _send(client, headers, room.id, content="m")
    await client.delete(f"/api/rooms/{room.id}/messages/{msg['id']}", headers=headers)
    on_deleted = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert on_deleted.status_code == 404


async def test_deleting_pinned_message_drops_it_from_list(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="m")
    await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert len(await _pins(client, headers, room.id)) == 1

    # Мягкое удаление закреплённого — снимает закрепление (целостность).
    await client.delete(f"/api/rooms/{room.id}/messages/{msg['id']}", headers=headers)
    assert await _pins(client, headers, room.id) == []


async def test_unpin_when_not_pinned(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="m")
    resp = await client.delete(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin", headers=headers
    )
    assert resp.status_code == 404


async def test_dm_participant_can_pin(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id, type="dm", name=None)
    await add_membership(room.id, a.id, "member")
    await add_membership(room.id, b.id, "member")

    a_headers = await _headers(client, a)
    msg = await _send(client, a_headers, room.id, content="hi")

    # В dm owner-роли нет — закрепить может любой из двух участников.
    pinned = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/pin",
        headers=await _headers(client, b),
    )
    assert pinned.status_code == 201
    assert len(await _pins(client, a_headers, room.id)) == 1
