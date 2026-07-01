"""Контракт WebSocket-событий: типы и билдеры исходящих сообщений.

Входящие команды клиента (валидируются в `chat.py`):
- `{"type": "subscribe",   "room_id": int}` — подписаться на комнату (после проверки доступа).
- `{"type": "unsubscribe", "room_id": int}` — отписаться.
- `{"type": "typing",      "room_id": int}` — «печатает» (эфемерно, в БД не пишется).
- `{"type": "ping"}` — проверка живости.
"""
from typing import Any

from app.schemas.message import MessageOut

# Типы исходящих событий.
EVENT_MESSAGE_NEW = "message.new"
EVENT_MESSAGE_EDITED = "message.edited"
EVENT_MESSAGE_DELETED = "message.deleted"
EVENT_PIN_ADDED = "pin.added"
EVENT_PIN_REMOVED = "pin.removed"
EVENT_READ = "read"
EVENT_TYPING = "typing"
EVENT_PRESENCE = "presence"
EVENT_SUBSCRIBED = "subscribed"
EVENT_UNSUBSCRIBED = "unsubscribed"
EVENT_ERROR = "error"
EVENT_PONG = "pong"


def message_new_event(message: MessageOut) -> dict[str, Any]:
    return {"type": EVENT_MESSAGE_NEW, "message": message.model_dump(mode="json")}


def message_edited_event(message: MessageOut) -> dict[str, Any]:
    return {"type": EVENT_MESSAGE_EDITED, "message": message.model_dump(mode="json")}


def message_deleted_event(room_id: int, message_id: int) -> dict[str, Any]:
    return {"type": EVENT_MESSAGE_DELETED, "room_id": room_id, "message_id": message_id}


def pin_added_event(room_id: int, message_id: int, pinned_by: int) -> dict[str, Any]:
    return {
        "type": EVENT_PIN_ADDED,
        "room_id": room_id,
        "message_id": message_id,
        "pinned_by": pinned_by,
    }


def pin_removed_event(room_id: int, message_id: int) -> dict[str, Any]:
    return {"type": EVENT_PIN_REMOVED, "room_id": room_id, "message_id": message_id}


def read_event(room_id: int, user_id: int, last_read_message_id: int | None) -> dict[str, Any]:
    return {
        "type": EVENT_READ,
        "room_id": room_id,
        "user_id": user_id,
        "last_read_message_id": last_read_message_id,
    }


def typing_event(room_id: int, user_id: int) -> dict[str, Any]:
    return {"type": EVENT_TYPING, "room_id": room_id, "user_id": user_id}


def presence_event(user_id: int, status: str) -> dict[str, Any]:
    return {"type": EVENT_PRESENCE, "user_id": user_id, "status": status}


def subscribed_event(room_id: int) -> dict[str, Any]:
    return {"type": EVENT_SUBSCRIBED, "room_id": room_id}


def unsubscribed_event(room_id: int) -> dict[str, Any]:
    return {"type": EVENT_UNSUBSCRIBED, "room_id": room_id}


def error_event(detail: str, room_id: int | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {"type": EVENT_ERROR, "detail": detail}
    if room_id is not None:
        event["room_id"] = room_id
    return event


def pong_event() -> dict[str, Any]:
    return {"type": EVENT_PONG}
