"""Тесты WebSocket-слоя: рукопожатие, доступ к подписке, живая доставка событий
(новое/удалённое сообщение, read-receipt, typing) и presence.

Доставка идёт через настоящий Redis pub/sub (мост стартует лениво при первом
подключении — lifespan в тестах не запускается). Нужны поднятые Redis и Postgres.

WS-клиент создаётся ВНУТРИ каждого теста (httpx_ws-транспорт держит anyio task group,
который должен открываться и закрываться в одной задаче; фикстура-генератор закрывает
его в другой задаче → ошибка cancel scope). Один клиент обслуживает и WS, и REST.
"""
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import pytest
from httpx import AsyncClient
from httpx_ws import WebSocketDisconnect, aconnect_ws
from httpx_ws.transport import ASGIWebSocketTransport

from app.main import app
from app.models.user import User

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)


@asynccontextmanager
async def _client() -> AsyncIterator[AsyncClient]:
    transport = ASGIWebSocketTransport(app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _token(client: AsyncClient, user: User) -> str:
    tokens = await login(client, user.username, "initpass123")
    return tokens["access_token"]


def _ws_url(token: str) -> str:
    return f"http://test/ws?token={token}"


async def _wait(
    ws: Any, predicate: Callable[[dict[str, Any]], bool], tries: int = 30
) -> dict[str, Any]:
    """Дождаться события по предикату (пропуская прочие, напр. presence)."""
    for _ in range(tries):
        msg = await ws.receive_json(timeout=3.0)
        if predicate(msg):
            return msg
    raise AssertionError("matching event not received")


def _is(type_: str) -> Callable[[dict[str, Any]], bool]:
    return lambda m: m.get("type") == type_


# --- рукопожатие -----------------------------------------------------------


async def test_handshake_requires_valid_token(make_user: MakeUser) -> None:
    user = await make_user()
    async with _client() as client:
        # Без токена — соединение закрывается на рукопожатии (1008).
        with pytest.raises(WebSocketDisconnect):
            async with aconnect_ws("http://test/ws", client):
                pass

        # С битым токеном — тоже.
        with pytest.raises(WebSocketDisconnect):
            async with aconnect_ws(_ws_url("garbage.token.value"), client):
                pass

        # Валидный access — подключается, отвечает на ping.
        async with aconnect_ws(_ws_url(await _token(client, user)), client) as ws:
            await ws.send_json({"type": "ping"})
            assert (await _wait(ws, _is("pong")))["type"] == "pong"


# --- подписка и доступ -----------------------------------------------------


async def test_subscribe_requires_membership(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    owner = await make_user()
    outsider = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")

    async with _client() as client:
        async with aconnect_ws(_ws_url(await _token(client, outsider)), client) as ws:
            await ws.send_json({"type": "subscribe", "room_id": room.id})
            msg = await _wait(ws, lambda m: m.get("type") in ("subscribed", "error"))
            assert msg["type"] == "error"  # посторонний в приватную комнату не вхож


# --- живая доставка --------------------------------------------------------


async def test_new_message_delivered_to_subscriber(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id, "member")

    async with _client() as client:
        b_headers = auth_headers(await _token(client, b))
        async with aconnect_ws(_ws_url(await _token(client, a)), client) as ws_a:
            await ws_a.send_json({"type": "subscribe", "room_id": room.id})
            await _wait(ws_a, _is("subscribed"))

            resp = await client.post(
                f"/api/rooms/{room.id}/messages",
                headers=b_headers,
                json={"content": "hi"},
            )
            assert resp.status_code == 201

            event = await _wait(ws_a, _is("message.new"))
            assert event["message"]["content"] == "hi"
            assert event["message"]["sender_id"] == b.id


async def test_deleted_message_delivered(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id, "member")

    async with _client() as client:
        b_headers = auth_headers(await _token(client, b))
        async with aconnect_ws(_ws_url(await _token(client, a)), client) as ws_a:
            await ws_a.send_json({"type": "subscribe", "room_id": room.id})
            await _wait(ws_a, _is("subscribed"))

            posted = await client.post(
                f"/api/rooms/{room.id}/messages",
                headers=b_headers,
                json={"content": "bye"},
            )
            message_id = posted.json()["id"]
            await _wait(ws_a, _is("message.new"))

            deleted = await client.delete(
                f"/api/rooms/{room.id}/messages/{message_id}", headers=b_headers
            )
            assert deleted.status_code == 204

            event = await _wait(ws_a, _is("message.deleted"))
            assert event["message_id"] == message_id


async def test_read_receipt_delivered(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id, "member")

    async with _client() as client:
        b_headers = auth_headers(await _token(client, b))
        async with aconnect_ws(_ws_url(await _token(client, a)), client) as ws_a:
            await ws_a.send_json({"type": "subscribe", "room_id": room.id})
            await _wait(ws_a, _is("subscribed"))

            posted = await client.post(
                f"/api/rooms/{room.id}/messages",
                headers=b_headers,
                json={"content": "m"},
            )
            message_id = posted.json()["id"]
            await _wait(ws_a, _is("message.new"))

            read = await client.post(
                f"/api/rooms/{room.id}/read",
                headers=b_headers,
                json={"last_read_message_id": message_id},
            )
            assert read.status_code == 200

            event = await _wait(ws_a, _is("read"))
            assert event["user_id"] == b.id
            assert event["last_read_message_id"] == message_id


async def test_typing_relayed_to_other_subscriber(
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    a = await make_user()
    b = await make_user()
    room = await make_room(created_by=a.id)
    await add_membership(room.id, a.id, "owner")
    await add_membership(room.id, b.id, "member")

    async with _client() as client:
        async with (
            aconnect_ws(_ws_url(await _token(client, a)), client) as ws_a,
            aconnect_ws(_ws_url(await _token(client, b)), client) as ws_b,
        ):
            for ws in (ws_a, ws_b):
                await ws.send_json({"type": "subscribe", "room_id": room.id})
                await _wait(ws, _is("subscribed"))

            await ws_a.send_json({"type": "typing", "room_id": room.id})
            event = await _wait(ws_b, _is("typing"))
            assert event["user_id"] == a.id
            assert event["room_id"] == room.id


# --- presence --------------------------------------------------------------


async def test_presence_online_offline(make_user: MakeUser) -> None:
    observer = await make_user()
    actor = await make_user()

    async with _client() as client:
        async with aconnect_ws(_ws_url(await _token(client, observer)), client) as ws_o:
            # actor подключается → observer видит online.
            async with aconnect_ws(_ws_url(await _token(client, actor)), client):
                online = await _wait(
                    ws_o,
                    lambda m: m.get("type") == "presence"
                    and m.get("user_id") == actor.id
                    and m.get("status") == "online",
                )
                assert online["status"] == "online"
            # actor отключился → observer видит offline.
            offline = await _wait(
                ws_o,
                lambda m: m.get("type") == "presence"
                and m.get("user_id") == actor.id
                and m.get("status") == "offline",
            )
            assert offline["status"] == "offline"
