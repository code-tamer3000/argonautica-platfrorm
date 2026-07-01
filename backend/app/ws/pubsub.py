"""Мост Redis pub/sub ↔ локальные сокеты.

Доставка идёт через Redis с первого дня (PLATFORM_SPEC §3.3): любой воркер
публикует событие в канал `room:{id}` / `presence`, а слушатель на каждом воркере
раздаёт его своим подписчикам через `ConnectionManager`. Так слой не зависит от
числа воркеров.

`ensure_listener_started` идемпотентен и стартует слушателя как из `lifespan`
(прод), так и при первом WS-подключении (тесты идут без lifespan). Он дожидается
завершения подписки на Redis, чтобы события, опубликованные сразу после, не терялись
(Redis pub/sub не буферизует).
"""
import asyncio
import contextlib
import json
import logging
from typing import Any

from app.core.redis import redis_client
from app.ws.manager import manager

logger = logging.getLogger(__name__)

_PRESENCE_CHANNEL = "presence"
_ROOM_PATTERN = "room:*"

_listener_task: asyncio.Task[None] | None = None
_ready: asyncio.Event | None = None


def _room_channel(room_id: int) -> str:
    return f"room:{room_id}"


async def publish_room_event(room_id: int, event: dict[str, Any]) -> None:
    """Опубликовать событие комнаты. Ошибку Redis глотаем — REST не должен падать."""
    try:
        await redis_client.publish(_room_channel(room_id), json.dumps(event))
    except Exception:
        logger.exception("Failed to publish room event for room %s", room_id)


async def publish_presence(event: dict[str, Any]) -> None:
    try:
        await redis_client.publish(_PRESENCE_CHANNEL, json.dumps(event))
    except Exception:
        logger.exception("Failed to publish presence event")


async def _run_listener(ready: asyncio.Event) -> None:
    pubsub = redis_client.pubsub()
    await pubsub.psubscribe(_ROOM_PATTERN)
    await pubsub.subscribe(_PRESENCE_CHANNEL)
    ready.set()  # подписки активны — публикации больше не потеряются
    try:
        async for message in pubsub.listen():
            if message.get("type") not in ("message", "pmessage"):
                continue
            channel = message["channel"]
            payload: dict[str, Any] = json.loads(message["data"])
            if channel == _PRESENCE_CHANNEL:
                await manager.broadcast(payload)
            else:
                room_id = int(channel.split(":", 1)[1])
                await manager.fanout_room(room_id, payload)
    except asyncio.CancelledError:
        raise
    finally:
        with contextlib.suppress(Exception):
            await pubsub.aclose()  # type: ignore[no-untyped-call]


async def ensure_listener_started() -> None:
    """Запустить слушателя на текущем event loop, если ещё не запущен на нём."""
    global _listener_task, _ready
    loop = asyncio.get_running_loop()
    if (
        _listener_task is not None
        and not _listener_task.done()
        and _listener_task.get_loop() is loop
        and _ready is not None
        and _ready.is_set()
    ):
        return
    _ready = asyncio.Event()
    _listener_task = loop.create_task(_run_listener(_ready))
    await _ready.wait()


async def stop_listener() -> None:
    """Остановить слушателя (lifespan-shutdown и очистка между тестами)."""
    global _listener_task, _ready
    if _listener_task is not None:
        _listener_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _listener_task
        _listener_task = None
        _ready = None
