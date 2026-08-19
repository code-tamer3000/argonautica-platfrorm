"""Тесты аутентификации: login, отказы, просроченный токен, refresh/logout."""
from datetime import UTC, date, datetime, timedelta

import jwt
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.intake import Intake

from .conftest import MakeUser, auth_headers, login


async def test_login_success(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(password="initpass123")
    resp = await client.post(
        "/api/auth/login", json={"username": user.username, "password": "initpass123"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_login_wrong_password(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(password="initpass123")
    resp = await client.post(
        "/api/auth/login", json={"username": user.username, "password": "WRONG"}
    )
    assert resp.status_code == 401


async def test_login_unknown_user(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/auth/login", json={"username": "nobody_here", "password": "x"}
    )
    assert resp.status_code == 401


async def test_expired_access_token_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user()
    now = datetime.now(UTC)
    expired = jwt.encode(
        {
            "sub": str(user.id),
            "type": "access",
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    resp = await client.get("/api/auth/me", headers=auth_headers(expired))
    assert resp.status_code == 401


async def test_small_clock_skew_tolerated(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Токен, выданный «чуть в будущем», принимается (CLOCK_SKEW_LEEWAY).

    Регрессия: без leeway шаг часов вперёд на секунду ронял валидацию iat
    (ImmatureSignatureError -> 401) у уже залогиненного юзера.
    """
    user = await make_user()
    now = datetime.now(UTC)
    skewed = jwt.encode(
        {
            "sub": str(user.id),
            "type": "access",
            "iat": now + timedelta(seconds=30),
            "exp": now + timedelta(minutes=15),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    resp = await client.get("/api/auth/me", headers=auth_headers(skewed))
    assert resp.status_code == 200, resp.text


async def test_large_clock_skew_still_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Допуск узкий: токен из далёкого будущего по-прежнему не проходит."""
    user = await make_user()
    now = datetime.now(UTC)
    forged = jwt.encode(
        {
            "sub": str(user.id),
            "type": "access",
            "iat": now + timedelta(hours=1),
            "exp": now + timedelta(hours=2),
        },
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    resp = await client.get("/api/auth/me", headers=auth_headers(forged))
    assert resp.status_code == 401


async def test_me_returns_current_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get("/api/auth/me", headers=auth_headers(tokens["access_token"]))
    assert resp.status_code == 200
    assert resp.json()["username"] == user.username


async def test_me_includes_intake_gate_fields(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-106: /me несёт intake_starts_on + intake_welcome_message для гейта Рубки/
    Календаря и приветственного поп-апа на клиенте."""
    starts_on = date.today() + timedelta(days=5)
    user = await make_user(password="initpass123", intake_starts_on=starts_on)
    intake = await session.get(Intake, user.intake_id)
    assert intake is not None
    intake.welcome_message = "Добро пожаловать в набор"
    await session.commit()

    tokens = await login(client, user.username, "initpass123")
    resp = await client.get("/api/auth/me", headers=auth_headers(tokens["access_token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["intake_starts_on"] == starts_on.isoformat()
    assert body["intake_welcome_message"] == "Добро пожаловать в набор"


async def test_me_intake_welcome_message_null_by_default(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Набор без установленного welcome_message (старые наборы) — поп-ап не показываем."""
    user = await make_user(password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get("/api/auth/me", headers=auth_headers(tokens["access_token"]))
    assert resp.status_code == 200
    assert resp.json()["intake_welcome_message"] is None


async def test_refresh_rotation_and_logout(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    old_refresh = tokens["refresh_token"]

    # /refresh выдаёт новую пару...
    r1 = await client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200
    new_refresh = r1.json()["refresh_token"]

    # ...а старый refresh после ротации больше не валиден.
    r2 = await client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 401

    # logout гасит текущий refresh.
    r3 = await client.post("/api/auth/logout", json={"refresh_token": new_refresh})
    assert r3.status_code == 204
    r4 = await client.post("/api/auth/refresh", json={"refresh_token": new_refresh})
    assert r4.status_code == 401
