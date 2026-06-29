"""Точка входа FastAPI. Каркас — наполняется по мере разработки."""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.messages import router as messages_router
from app.api.rooms import router as rooms_router
from app.core.redis import close_redis, redis_client
from app.ws.chat import router as ws_router
from app.ws.pubsub import ensure_listener_started, stop_listener


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Проверяем доступность Redis на старте (fail-fast), поднимаем pub/sub-слушателя
    # реалтайма, на остановке — гасим его и закрываем пул.
    await redis_client.ping()
    await ensure_listener_started()
    try:
        yield
    finally:
        await stop_listener()
        await close_redis()


app = FastAPI(title="Platform API", lifespan=lifespan)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(rooms_router)
app.include_router(messages_router)
app.include_router(ws_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
