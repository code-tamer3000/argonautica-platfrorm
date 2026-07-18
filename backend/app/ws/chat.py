"""WebSocket-эндпоинт `/ws` — живой слой чата.

Аутентификация рукопожатия по JWT (PLATFORM_SPEC §6.5: проверять токен при коннекте,
членство — перед подпиской на комнату; IDOR — угроза №1). Браузер не шлёт заголовки
на WS, поэтому access-токен приходит query-параметром `?token=...` (WSS шифрует).
Клиент обязан уметь переподключение (CLAUDE.md: при blue-green сокеты рвутся).
"""
import logging
from typing import Annotated, Any

import jwt
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

from app.core.redis import redis_client
from app.core.security import ACCESS_TOKEN_TYPE, decode_token
from app.db.session import SessionLocal
from app.models.user import User
from app.services.rooms import assert_room_access, load_room
from app.ws import schemas
from app.ws.manager import Conn, manager
from app.ws.pubsub import ensure_listener_started, publish_presence, publish_room_event

logger = logging.getLogger(__name__)

router = APIRouter()


async def _authenticate(websocket: WebSocket, token: str | None) -> User | None:
    """Проверить access-токен и загрузить юзера. Отказ → закрыть рукопожатие (1008)."""
    if not token:
        await websocket.close(code=1008)
        return None
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        await websocket.close(code=1008)
        return None
    if payload.get("type") != ACCESS_TOKEN_TYPE or payload.get("sub") is None:
        await websocket.close(code=1008)
        return None

    async with SessionLocal() as session:
        user = await session.get(User, int(payload["sub"]))
    if user is None or user.must_change_password:
        await websocket.close(code=1008)
        return None
    return user


async def _presence_connect(user: User) -> None:
    """Первое соединение юзера → online. Refcount в Redis — корректно при N воркерах."""
    count = await redis_client.incr(f"presence:count:{user.id}")
    if count == 1:
        await redis_client.sadd("presence:online", user.id)
        await publish_presence(schemas.presence_event(user.id, "online"))


async def _presence_disconnect(user: User) -> None:
    """Последнее соединение юзера закрылось → offline."""
    count = await redis_client.decr(f"presence:count:{user.id}")
    if count <= 0:
        await redis_client.delete(f"presence:count:{user.id}")
        await redis_client.srem("presence:online", user.id)
        await publish_presence(schemas.presence_event(user.id, "offline"))


async def _subscribe(conn: Conn, room_id: int) -> None:
    """Подписка с серверной проверкой доступа (членство dm/group, вариант А канала)."""
    async with SessionLocal() as session:
        try:
            room = await load_room(session, room_id)
            await assert_room_access(session, room, conn.user)
        except HTTPException as exc:
            await conn.send_json(schemas.error_event(str(exc.detail), room_id=room_id))
            return
    manager.subscribe(conn, room_id)
    await conn.send_json(schemas.subscribed_event(room_id))


async def _handle(conn: Conn, data: Any) -> None:
    if not isinstance(data, dict):
        await conn.send_json(schemas.error_event("Malformed message"))
        return
    mtype = data.get("type")

    if mtype in ("subscribe", "unsubscribe", "typing"):
        room_id = data.get("room_id")
        if not isinstance(room_id, int):
            await conn.send_json(schemas.error_event("room_id (int) required"))
            return
        if mtype == "subscribe":
            await _subscribe(conn, room_id)
        elif mtype == "unsubscribe":
            manager.unsubscribe(conn, room_id)
            await conn.send_json(schemas.unsubscribed_event(room_id))
        elif room_id in conn.subscribed and not conn.user.is_observer:
            # typing — только в подписанную комнату; наблюдателю чат недоступен целиком
            # (он и подписаться не сможет — assert_room_access его отбивает), барьер на
            # всякий случай.
            await publish_room_event(
                room_id, schemas.typing_event(room_id, conn.user.id)
            )
    elif mtype == "ping":
        await conn.send_json(schemas.pong_event())
    else:
        await conn.send_json(schemas.error_event("Unknown message type"))


@router.websocket("/ws")
async def chat_ws(
    websocket: WebSocket,
    token: Annotated[str | None, Query()] = None,
) -> None:
    user = await _authenticate(websocket, token)
    if user is None:
        return
    await websocket.accept()
    await ensure_listener_started()

    conn = Conn(websocket, user)
    manager.register(conn)
    await _presence_connect(user)
    try:
        while True:
            data = await websocket.receive_json()
            await _handle(conn, data)
    except WebSocketDisconnect:
        pass
    finally:
        manager.unregister(conn)
        await _presence_disconnect(user)
