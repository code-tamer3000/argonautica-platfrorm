"""Точка входа FastAPI. Каркас — наполняется по мере разработки."""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.redis import close_redis, redis_client


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Проверяем доступность Redis на старте (fail-fast), закрываем пул на остановке.
    await redis_client.ping()
    try:
        yield
    finally:
        await close_redis()


app = FastAPI(title="Platform API", lifespan=lifespan)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# TODO (фундамент готов — дальше эндпоинты фич):
#   - app/api/               — REST-роутеры, подключить через include_router
#   - app/ws/                — WebSocket-эндпоинты + интеграция с Redis pub/sub
#   - app/schemas/           — Pydantic-схемы запросов/ответов
