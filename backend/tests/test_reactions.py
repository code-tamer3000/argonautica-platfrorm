"""Тесты реакций на сообщения (один фиксированный образ, MVP): идемпотентность,
батч-агрегация count/reacted_by_me на нескольких зрителях, авторизация (наблюдатель/
выпускник не реагируют), целостность при отсутствующем/удалённом сообщении."""
from datetime import UTC, datetime

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


async def _feed(client: AsyncClient, headers: dict[str, str], room_id: int) -> list[dict]:
    resp = await client.get(f"/api/rooms/{room_id}/messages", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_react_and_unreact(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="react to me")

    added = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=headers
    )
    assert added.status_code == 201

    feed = await _feed(client, headers, room.id)
    assert feed[0]["reaction_count"] == 1
    assert feed[0]["reacted_by_me"] is True

    removed = await client.delete(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=headers
    )
    assert removed.status_code == 204

    feed = await _feed(client, headers, room.id)
    assert feed[0]["reaction_count"] == 0
    assert feed[0]["reacted_by_me"] is False


async def test_reaction_is_idempotent(
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
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=headers
    )
    assert first.status_code == 201
    again = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=headers
    )
    assert again.status_code == 200  # уже поставлена — не дублим

    feed = await _feed(client, headers, room.id)
    assert feed[0]["reaction_count"] == 1  # не задвоилось


async def test_multiple_users_reaction_count_per_viewer(
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

    await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=owner_headers
    )
    await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=member_headers
    )

    # Общий счётчик одинаковый для всех, reacted_by_me — своё у каждого.
    owner_feed = await _feed(client, owner_headers, room.id)
    member_feed = await _feed(client, member_headers, room.id)
    assert owner_feed[0]["reaction_count"] == 2
    assert owner_feed[0]["reacted_by_me"] is True
    assert member_feed[0]["reaction_count"] == 2
    assert member_feed[0]["reacted_by_me"] is True

    # Снял свою — счётчик уменьшился, у второго зрителя reacted_by_me не изменился.
    await client.delete(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=owner_headers
    )
    member_feed = await _feed(client, member_headers, room.id)
    assert member_feed[0]["reaction_count"] == 1
    assert member_feed[0]["reacted_by_me"] is True


async def test_react_missing_or_deleted_message(
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
        f"/api/rooms/{room.id}/messages/999999/reaction", headers=headers
    )
    assert missing.status_code == 404

    msg = await _send(client, headers, room.id, content="m")
    await client.delete(f"/api/rooms/{room.id}/messages/{msg['id']}", headers=headers)
    on_deleted = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=headers
    )
    assert on_deleted.status_code == 404


async def test_unreact_when_not_reacted(
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
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction", headers=headers
    )
    assert resp.status_code == 404


async def test_observer_and_graduate_cannot_react(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    observer = await make_user(is_observer=True)
    graduate = await make_user(graduated_at=datetime.now(UTC))
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    await add_membership(room.id, graduate.id, "member")
    headers = await _headers(client, owner)

    msg = await _send(client, headers, room.id, content="m")

    observer_resp = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction",
        headers=await _headers(client, observer),
    )
    assert observer_resp.status_code == 403

    graduate_resp = await client.post(
        f"/api/rooms/{room.id}/messages/{msg['id']}/reaction",
        headers=await _headers(client, graduate),
    )
    assert graduate_resp.status_code == 403
