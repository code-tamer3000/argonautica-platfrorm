"""Общие фикстуры тестов.

Требует применённых миграций (CI гоняет `alembic upgrade head` перед pytest;
локально — то же). Тесты ходят в приложение через ASGI-транспорт (без lifespan —
Redis/engine коннектятся лениво) и пишут seed-юзеров прямо через SessionLocal.
Event loop — session-scoped, чтобы глобальные async engine/redis жили на одном loop.
"""
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import date, datetime, timedelta

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import redis_client
from app.core.security import hash_password
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.intake import Intake
from app.models.room import Room, RoomMember
from app.models.user import User
from app.ws.pubsub import stop_listener

# Окно Динамики (28 дней) считается от даты старта НАБОРА пользователя. В тестах
# дата всегда относительная: набор по умолчанию стартовал неделю назад, поэтому
# «вчера» гарантированно внутри окна в любой календарный день, и суите не грозит
# дата-бомба (ARG-70).
DEFAULT_INTAKE_OFFSET_DAYS = 7

MakeUser = Callable[..., Awaitable[User]]
MakeRoom = Callable[..., Awaitable[Room]]
AddMembership = Callable[..., Awaitable[RoomMember]]


@pytest_asyncio.fixture(autouse=True)
def _disable_rate_limit() -> None:
    """Rate-limit выключен для всего набора, чтобы повторные login/send не упирались
    в лимиты. test_ratelimit включает его точечно через monkeypatch."""
    settings.rate_limit_enabled = False


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


async def get_or_create_intake(
    session: AsyncSession, starts_on: date, ends_on: date | None = None
) -> Intake:
    """Набор с указанной датой старта (`intakes.starts_on` UNIQUE — переиспользуем).

    `ends_on` по умолчанию далеко в будущем (окно заведомо открыто) — большинству
    тестов дата закрытия набора не важна. Тесты окна (ARG-96) передают своё значение.
    """
    intake = await session.scalar(select(Intake).where(Intake.starts_on == starts_on))
    if intake is None:
        intake = Intake(starts_on=starts_on, ends_on=ends_on or starts_on + timedelta(days=400))
        session.add(intake)
        await session.commit()
        await session.refresh(intake)
    return intake


@pytest_asyncio.fixture
async def make_user(session: AsyncSession) -> MakeUser:
    """Фабрика seed-юзеров. Уникальный username, пароль уже захеширован argon2.

    Пользователь всегда попадает в набор: по умолчанию — стартовавший
    `DEFAULT_INTAKE_OFFSET_DAYS` дней назад. `intake_starts_on` задаёт свою дату,
    чтобы проверять участников разных наборов в один календарный день.
    """

    async def _make(
        *,
        role: str = "participant",
        must_change: bool = False,
        password: str = "initpass123",
        username: str | None = None,
        display_name: str = "Test User",
        email: str | None = None,
        can_create_groups: bool = True,
        can_access_cabin: bool = False,
        is_observer: bool = False,
        is_navigator: bool = False,
        graduated_at: datetime | None = None,
        intake_starts_on: date | None = None,
        intake_ends_on: date | None = None,
        intake_id: int | None = None,
        plan_id: int | None = None,
    ) -> User:
        if intake_id is None:
            intake = await get_or_create_intake(
                session,
                intake_starts_on
                or date.today() - timedelta(days=DEFAULT_INTAKE_OFFSET_DAYS),
                intake_ends_on,
            )
            intake_id = intake.id
        user = User(
            intake_id=intake_id,
            plan_id=plan_id,
            username=username or f"u_{uuid.uuid4().hex[:12]}",
            display_name=display_name,
            email=email,
            role=role,
            password_hash=hash_password(password),
            must_change_password=must_change,
            can_create_groups=can_create_groups,
            can_access_cabin=can_access_cabin,
            is_observer=is_observer,
            is_navigator=is_navigator,
            graduated_at=graduated_at,
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
