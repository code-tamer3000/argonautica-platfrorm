"""Реестр WebSocket-соединений в пределах одного процесса.

Доставка между воркерами идёт через Redis pub/sub (см. `pubsub.py`); этот реестр —
последняя миля: раздать пришедшее из шины событие локальным сокетам, подписанным на
комнату. Один инстанс `manager` на процесс.
"""
from typing import Any

from fastapi import WebSocket

from app.models.user import User


class Conn:
    """Одно WebSocket-соединение: сокет + кто за ним + на какие комнаты подписан."""

    def __init__(self, websocket: WebSocket, user: User) -> None:
        self.websocket = websocket
        self.user = user
        self.subscribed: set[int] = set()

    async def send_json(self, payload: dict[str, Any]) -> bool:
        """Отправить событие. False, если сокет умер (вызывающий снимет соединение)."""
        try:
            await self.websocket.send_json(payload)
            return True
        except Exception:
            return False


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[int, set[Conn]] = {}
        self._conns: set[Conn] = set()
        # user_id -> его соединения (может быть несколько вкладок/устройств).
        # Нужен для персональной доставки уведомлений, не привязанной к комнате.
        self._users: dict[int, set[Conn]] = {}

    def register(self, conn: Conn) -> None:
        self._conns.add(conn)
        self._users.setdefault(conn.user.id, set()).add(conn)

    def unregister(self, conn: Conn) -> None:
        self._conns.discard(conn)
        peers = self._users.get(conn.user.id)
        if peers is not None:
            peers.discard(conn)
            if not peers:
                del self._users[conn.user.id]
        for room_id in list(conn.subscribed):
            self._unbind(conn, room_id)
        conn.subscribed.clear()

    def subscribe(self, conn: Conn, room_id: int) -> None:
        conn.subscribed.add(room_id)
        self._rooms.setdefault(room_id, set()).add(conn)

    def unsubscribe(self, conn: Conn, room_id: int) -> None:
        conn.subscribed.discard(room_id)
        self._unbind(conn, room_id)

    def _unbind(self, conn: Conn, room_id: int) -> None:
        peers = self._rooms.get(room_id)
        if peers is not None:
            peers.discard(conn)
            if not peers:
                del self._rooms[room_id]

    async def fanout_room(self, room_id: int, payload: dict[str, Any]) -> None:
        """Раздать событие подписчикам комнаты; мёртвые соединения снять."""
        for conn in list(self._rooms.get(room_id, ())):
            if not await conn.send_json(payload):
                self.unregister(conn)

    async def fanout_user(self, user_id: int, payload: dict[str, Any]) -> None:
        """Раздать событие всем соединениям конкретного юзера (уведомления)."""
        for conn in list(self._users.get(user_id, ())):
            if not await conn.send_json(payload):
                self.unregister(conn)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Раздать событие всем соединениям процесса (presence)."""
        for conn in list(self._conns):
            if not await conn.send_json(payload):
                self.unregister(conn)

    def connection_count(self) -> int:
        """Живых WebSocket-соединений в этом процессе (для админ-мониторинга)."""
        return len(self._conns)


manager = ConnectionManager()
