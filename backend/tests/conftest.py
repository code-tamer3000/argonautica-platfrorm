"""Общие фикстуры тестов.

Требует применённых миграций (CI гоняет `alembic upgrade head` перед pytest;
локально — то же). Тесты ходят в приложение через ASGI-транспорт (без lifespan —
Redis/engine коннектятся лениво) и пишут seed-юзеров прямо через SessionLocal.
Event loop — session-scoped, чтобы глобальные async engine/redis жили на одном loop.
"""
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis import redis_client
from app.core.security import hash_password
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.user import User

MakeUser = Callable[..., Awaitable[User]]


@pytest_asyncio.fixture(autouse=True)
async def _reset_pools() -> AsyncIterator[None]:
    """Каждый тест бежит на своём event loop (pytest-asyncio 1.x).

    Глобальные async engine/redis держат пул соединений, привязанных к loop'у, на
    котором их создали. После теста сбрасываем соединения, чтобы следующий тест на
    новом loop'е получил свежие, а не «Event loop is closed».
    """
    yield
    await engine.dispose()
    await redis_client.connection_pool.disconnect()


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as s:
        yield s


@pytest_asyncio.fixture
async def make_user(session: AsyncSession) -> MakeUser:
    """Фабрика seed-юзеров. Уникальный username, пароль уже захеширован argon2."""

    async def _make(
        *,
        role: str = "participant",
        must_change: bool = False,
        password: str = "initpass123",
        username: str | None = None,
        email: str | None = None,
    ) -> User:
        user = User(
            username=username or f"u_{uuid.uuid4().hex[:12]}",
            display_name="Test User",
            email=email,
            role=role,
            password_hash=hash_password(password),
            must_change_password=must_change,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user

    return _make


async def login(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    """Хелпер: логин, вернуть тело TokenPair (access_token/refresh_token)."""
    resp = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}
