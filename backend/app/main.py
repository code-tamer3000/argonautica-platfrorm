"""Точка входа FastAPI. Каркас — наполняется по мере разработки."""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.api.calendar import router as calendar_router
from app.api.dynamics import router as dynamics_router
from app.api.kb import router as kb_router
from app.api.media import router as media_router
from app.api.messages import router as messages_router
from app.api.rooms import router as rooms_router
from app.api.stickers import router as stickers_router
from app.api.users import router as users_router
from app.core.redis import close_redis, redis_client
from app.db.session import SessionLocal
from app.services.media import ensure_buckets
from app.services.rooms import ensure_news_channel
from app.ws.chat import router as ws_router
from app.ws.pubsub import ensure_listener_started, stop_listener


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Проверяем доступность Redis на старте (fail-fast), создаём бакеты MinIO,
    # гарантируем новостной канал, поднимаем pub/sub-слушателя реалтайма;
    # на остановке — гасим его и закрываем пул.
    await redis_client.ping()
    await run_in_threadpool(ensure_buckets)
    async with SessionLocal() as session:
        await ensure_news_channel(session)
        await session.commit()
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
app.include_router(media_router)
app.include_router(kb_router)
app.include_router(users_router)
app.include_router(stickers_router)
app.include_router(calendar_router)
app.include_router(dynamics_router)
app.include_router(ws_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
