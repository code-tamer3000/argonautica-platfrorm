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
from app.models.room import Room, RoomMember
from app.models.user import User
from app.ws.pubsub import stop_listener

MakeUser = Callable[..., Awaitable[User]]
MakeRoom = Callable[..., Awaitable[Room]]
AddMembership = Callable[..., Awaitable[RoomMember]]


@pytest_asyncio.fixture(autouse=True)
async def _reset_pools() -> AsyncIterator[None]:
    """Каждый тест бежит на своём event loop (pytest-asyncio 1.x).

    Глобальные async engine/redis держат пул соединений, привязанных к loop'у, на
    котором их создали. После теста сбрасываем соединения, чтобы следующий тест на
    новом loop'е получил свежие, а не «Event loop is closed».
    """
    yield
    # Гасим pub/sub-слушателя реалтайма — он привязан к loop'у теста.
    await stop_listener()
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
        can_create_groups: bool = True,
    ) -> User:
        user = User(
            username=username or f"u_{uuid.uuid4().hex[:12]}",
            display_name="Test User",
            email=email,
            role=role,
            password_hash=hash_password(password),
            must_change_password=must_change,
            can_create_groups=can_create_groups,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user

    return _make


@pytest_asyncio.fixture
async def make_room(session: AsyncSession) -> MakeRoom:
    """Фабрика комнат. По умолчанию группа; для dm задаём уникальный dm_key."""

    async def _make(
        *,
        created_by: int,
        type: str = "group",
        name: str | None = "Test Group",
        dm_key: str | None = None,
    ) -> Room:
        if type == "dm" and dm_key is None:
            dm_key = f"dm_{uuid.uuid4().hex[:12]}"
        room = Room(type=type, name=name, dm_key=dm_key, created_by=created_by)
        session.add(room)
        await session.commit()
        await session.refresh(room)
        return room

    return _make


@pytest_asyncio.fixture
async def add_membership(session: AsyncSession) -> AddMembership:
    """Фабрика членства в комнате."""

    async def _add(
        room_id: int, user_id: int, role: str = "member"
    ) -> RoomMember:
        membership = RoomMember(room_id=room_id, user_id=user_id, role_in_room=role)
        session.add(membership)
        await session.commit()
        await session.refresh(membership)
        return membership

    return _add


async def login(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    """Хелпер: логин, вернуть тело TokenPair (access_token/refresh_token)."""
    resp = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def auth_headers(access_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access_token}"}
