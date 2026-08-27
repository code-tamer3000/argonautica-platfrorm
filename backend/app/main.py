"""Точка входа FastAPI. Каркас — наполняется по мере разработки."""
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.api.admin import router as admin_router
from app.api.applications import router as applications_router
from app.api.auth import router as auth_router
from app.api.cabin import router as cabin_router
from app.api.calendar import router as calendar_router
from app.api.dynamics import router as dynamics_router
from app.api.faq import router as faq_router
from app.api.feedback import router as feedback_router
from app.api.kb import router as kb_router
from app.api.media import router as media_router
from app.api.messages import router as messages_router
from app.api.metrics import router as metrics_router
from app.api.notifications import router as notifications_router
from app.api.push import router as push_router
from app.api.rooms import router as rooms_router
from app.api.stickers import router as stickers_router
from app.api.stream import router as stream_router
from app.api.survey import router as survey_router
from app.api.tasks import router as tasks_router
from app.api.users import router as users_router
from app.core.metrics import render_prometheus
from app.core.observability import ObservabilityMiddleware
from app.core.redis import close_redis, redis_client
from app.db.session import SessionLocal
from app.models.intake import Intake
from app.services.media import ensure_buckets
from app.services.rooms import ensure_news_channel
from app.ws.chat import router as ws_router
from app.ws.pubsub import ensure_listener_started, stop_listener


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Проверяем доступность Redis на старте (fail-fast), создаём бакеты MinIO,
    # гарантируем новостной канал каждого потока (ARG-104 — больше не singleton),
    # поднимаем pub/sub-слушателя реалтайма; на остановке — гасим его и закрываем пул.
    await redis_client.ping()
    await run_in_threadpool(ensure_buckets)
    async with SessionLocal() as session:
        intake_ids = (await session.execute(select(Intake.id))).scalars().all()
        for intake_id in intake_ids:
            await ensure_news_channel(session, intake_id)
        await session.commit()
    await ensure_listener_started()
    try:
        yield
    finally:
        await stop_listener()
        await close_redis()


app = FastAPI(title="Platform API", lifespan=lifespan)

# Наблюдаемость — самым внешним слоем, чтобы в замер попадало всё время обработки,
# включая работу зависимостей и сериализацию ответа (docs/API_CONVENTIONS.md).
app.add_middleware(ObservabilityMiddleware)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(applications_router)
app.include_router(rooms_router)
app.include_router(messages_router)
app.include_router(media_router)
app.include_router(metrics_router)
app.include_router(kb_router)
app.include_router(users_router)
app.include_router(stickers_router)
app.include_router(calendar_router)
app.include_router(cabin_router)
app.include_router(dynamics_router)
app.include_router(faq_router)
app.include_router(feedback_router)
app.include_router(notifications_router)
app.include_router(push_router)
# Поток — до tasks_router: его пути конкретнее, чем /api/tasks/{task_id}.
app.include_router(stream_router)
app.include_router(survey_router)
app.include_router(tasks_router)
app.include_router(ws_router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/metrics")
async def metrics() -> Response:
    """Экспорт в формате Prometheus для VictoriaMetrics (ARG-82).

    Без `/api`-префикса и без auth-зависимости намеренно: нужен только скрейперу
    внутри docker-сети, а не пользователям приложения. Наружу не публикуется —
    backend-контейнеры не объявляют host-портов (только nginx их проксирует, и
    `/metrics` в его локациях нет), см. docs/DEPLOY.md «Наблюдаемость».
    """
    return Response(content=await render_prometheus(), media_type="text/plain; version=0.0.4")
