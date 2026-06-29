"""Тесты аутентификации: login, отказы, просроченный токен, refresh/logout."""
from datetime import UTC, datetime, timedelta

import jwt
from httpx import AsyncClient

from app.core.config import settings

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


async def test_me_returns_current_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get("/api/auth/me", headers=auth_headers(tokens["access_token"]))
    assert resp.status_code == 200
    assert resp.json()["username"] == user.username


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
