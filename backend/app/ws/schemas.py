"""Контракт WebSocket-событий: типы и билдеры исходящих сообщений.

Входящие команды клиента (валидируются в `chat.py`):
- `{"type": "subscribe",   "room_id": int}` — подписаться на комнату (после проверки доступа).
- `{"type": "unsubscribe", "room_id": int}` — отписаться.
- `{"type": "typing",      "room_id": int}` — «печатает» (эфемерно, в БД не пишется).
- `{"type": "ping"}` — проверка живости.
"""
from typing import Any

from app.schemas.message import MessageOut
from app.schemas.notification import NotificationOut

# Типы исходящих событий.
EVENT_MESSAGE_NEW = "message.new"
EVENT_NOTIFICATION_NEW = "notification.new"
EVENT_NOTIFICATION_REMOVED = "notification.removed"
EVENT_MESSAGE_EDITED = "message.edited"
EVENT_MESSAGE_DELETED = "message.deleted"
EVENT_PIN_ADDED = "pin.added"
EVENT_PIN_REMOVED = "pin.removed"
EVENT_REACTION_ADDED = "reaction.added"
EVENT_REACTION_REMOVED = "reaction.removed"
EVENT_READ = "read"
EVENT_TYPING = "typing"
EVENT_PRESENCE = "presence"
EVENT_SUBSCRIBED = "subscribed"
EVENT_UNSUBSCRIBED = "unsubscribed"
EVENT_ERROR = "error"
EVENT_PONG = "pong"
# Задачи — доставка через персональный канал user:{id} (publish_user_event).
EVENT_TASK_CREATED = "task.created"
EVENT_TASK_UPDATED = "task.updated"
EVENT_TASK_SUBMISSION_NEW = "submission.new"
EVENT_TASK_SUBMISSION_STATUS = "submission.status"
EVENT_TASK_COMMENT_NEW = "task.comment.new"
# Транскод видео готов/провалился — в канал комнаты, клиент меняет processing→playable
# (или помечает failed) прямо в ленте, без перезагрузки. Payload несёт свежий
# attachment (с variant-URL), чтобы клиент подставил его на месте (docs/MESSAGES.md).
EVENT_ATTACHMENT_UPDATED = "attachment.updated"
# Юзера добавили в новую комнату, которую создал сервер (комнаты узлов потока).
# Клиент инвалидирует список комнат — иначе она появится только после reconnect.
EVENT_ROOM_CREATED = "room.created"
# Комната закрыта сервером: подгруппа потока утвердила фразу, этап пройден. Клиент
# убирает её из списка — доступа к ней у бывших членов больше нет (docs/ROOMS.md).
EVENT_ROOM_CLOSED = "room.closed"


def _with_cheap_tariff_content(
    event: dict[str, Any], redacted_content: str | None
) -> dict[str, Any]:
    """Прицепить редактированный вариант текста поверх обычного payload'а — снимается
    в pubsub-слушателе (см. `pubsub._apply_cheap_tariff_redaction`) перед раздачей
    конкретному сокету, никогда не уходит клиенту как есть (ARG-115)."""
    if redacted_content is not None:
        event["content_for_cheap_tariff"] = redacted_content
    return event


def message_new_event(
    message: MessageOut, redacted_content: str | None = None
) -> dict[str, Any]:
    event = {"type": EVENT_MESSAGE_NEW, "message": message.model_dump(mode="json")}
    return _with_cheap_tariff_content(event, redacted_content)


def message_edited_event(
    message: MessageOut, redacted_content: str | None = None
) -> dict[str, Any]:
    event = {"type": EVENT_MESSAGE_EDITED, "message": message.model_dump(mode="json")}
    return _with_cheap_tariff_content(event, redacted_content)


def notification_new_event(notification: NotificationOut) -> dict[str, Any]:
    return {
        "type": EVENT_NOTIFICATION_NEW,
        "notification": notification.model_dump(mode="json"),
    }


def notification_removed_event(notification_id: int, was_unread: bool) -> dict[str, Any]:
    """Уведомление снято сервером (напр. админ зачёл день дневника)."""
    return {
        "type": EVENT_NOTIFICATION_REMOVED,
        "notification_id": notification_id,
        "was_unread": was_unread,
    }


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


def reaction_added_event(
    room_id: int, message_id: int, user_id: int, count: int
) -> dict[str, Any]:
    """Payload намеренно не несёт MessageOut — только счётчик и кто нажал. Каждый
    клиент сам выводит reacted_by_me, сравнивая user_id со своим (см. docs/MESSAGES.md)."""
    return {
        "type": EVENT_REACTION_ADDED,
        "room_id": room_id,
        "message_id": message_id,
        "user_id": user_id,
        "count": count,
    }


def reaction_removed_event(
    room_id: int, message_id: int, user_id: int, count: int
) -> dict[str, Any]:
    return {
        "type": EVENT_REACTION_REMOVED,
        "room_id": room_id,
        "message_id": message_id,
        "user_id": user_id,
        "count": count,
    }


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


# --- Задачи (payload'ы маленькие: id + минимум полей) ----------------------


def task_created_event(task_id: int, task_type: str, title: str) -> dict[str, Any]:
    return {
        "type": EVENT_TASK_CREATED,
        "task_id": task_id,
        "task_type": task_type,
        "title": title,
    }


def task_updated_event(task_id: int) -> dict[str, Any]:
    return {"type": EVENT_TASK_UPDATED, "task_id": task_id}


def room_created_event(room_id: int) -> dict[str, Any]:
    return {"type": EVENT_ROOM_CREATED, "room_id": room_id}


def room_closed_event(room_id: int) -> dict[str, Any]:
    return {"type": EVENT_ROOM_CLOSED, "room_id": room_id}


def task_submission_new_event(
    task_id: int, assignment_id: int, submission_id: int, user_id: int
) -> dict[str, Any]:
    return {
        "type": EVENT_TASK_SUBMISSION_NEW,
        "task_id": task_id,
        "assignment_id": assignment_id,
        "submission_id": submission_id,
        "user_id": user_id,
    }


def task_submission_status_event(
    task_id: int, assignment_id: int, status: str
) -> dict[str, Any]:
    return {
        "type": EVENT_TASK_SUBMISSION_STATUS,
        "task_id": task_id,
        "assignment_id": assignment_id,
        "status": status,
    }


def attachment_updated_event(
    room_id: int,
    message_id: int,
    attachment: dict[str, Any],
) -> dict[str, Any]:
    """Транскод видео завершён (done/failed). `attachment` — сериализованный
    AttachmentOut со свежим состоянием (transcode_status + variant-URL при done).
    Клиент находит вложение по asset_id внутри и подменяет его в сообщении."""
    return {
        "type": EVENT_ATTACHMENT_UPDATED,
        "room_id": room_id,
        "message_id": message_id,
        "attachment": attachment,
    }


def task_comment_new_event(
    task_id: int, submission_id: int, comment_id: int
) -> dict[str, Any]:
    return {
        "type": EVENT_TASK_COMMENT_NEW,
        "task_id": task_id,
        "submission_id": submission_id,
        "comment_id": comment_id,
    }
