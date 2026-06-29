"""Async-клиент Redis.

Redis — pub/sub между воркерами и всё эфемерное состояние (presence, «печатает»,
refresh-сессии, rate-limit). Один пул на процесс; открытие/закрытие — в lifespan.
"""
from redis.asyncio import Redis, from_url

from app.core.config import settings

# Единый клиент с пулом соединений. decode_responses=True — строки, не bytes.
redis_client: Redis = from_url(settings.redis_url, decode_responses=True)


def get_redis() -> Redis:
    """Зависимость FastAPI: общий клиент Redis."""
    return redis_client


async def close_redis() -> None:
    """Закрыть пул при остановке приложения."""
    await redis_client.aclose()
