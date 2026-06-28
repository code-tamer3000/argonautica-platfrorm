"""Точка входа FastAPI. Каркас — наполняется по мере разработки."""
from fastapi import FastAPI

app = FastAPI(title="Platform API")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# TODO:
#   - app/core/config.py     — настройки из окружения (pydantic-settings)
#   - app/core/security.py   — JWT (access/refresh), хеш паролей (argon2)
#   - app/core/redis.py      — клиент Redis (pub/sub, presence, сессии, rate-limit)
#   - app/db/session.py      — async-движок и сессии SQLAlchemy
#   - app/models/            — модели (users, rooms, room_members, messages, ...)
#   - app/api/               — REST-роутеры, подключить через include_router
#   - app/ws/                — WebSocket-эндпоинты + интеграция с Redis pub/sub
#   - app/services/media.py  — presigned-PUT/GET в MinIO через boto3
