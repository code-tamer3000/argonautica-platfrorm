"""Точка входа FastAPI. Каркас — наполняется по мере разработки."""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.rooms import router as rooms_router
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

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(rooms_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# TODO (дальше эндпоинты фич):
#   - app/api/               — чат/комнаты/база знаний (поверх auth-фундамента)
#   - app/ws/                — WebSocket-эндпоинты + интеграция с Redis pub/sub
