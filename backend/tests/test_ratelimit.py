"""Тесты rate-limiting (§6.6). Для набора лимиты выключены (autouse-фикстура);
здесь включаем точечно через monkeypatch на синглтон settings (читается в рантайме)."""
import uuid

import pytest
from httpx import AsyncClient

from app.core.config import settings

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)


async def test_login_rate_limited(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_login_per_minute", 3)
    # Уникальный X-Forwarded-For → уникальный ключ rl:login (без пересечений прогонов).
    headers = {"X-Forwarded-For": f"ip-{uuid.uuid4().hex}"}
    body = {"username": "nouser", "password": "wrong"}

    for _ in range(3):
        resp = await client.post("/api/auth/login", json=body, headers=headers)
        assert resp.status_code == 401  # неверные данные, но в пределах лимита

    blocked = await client.post("/api/auth/login", json=body, headers=headers)
    assert blocked.status_code == 429
    assert "retry-after" in {k.lower() for k in blocked.headers}


async def test_send_rate_limited(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_send_per_minute", 2)

    owner = await make_user()
    room = await make_room(created_by=owner.id)
    await add_membership(room.id, owner.id, "owner")
    tokens = await login(client, owner.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    for _ in range(2):
        ok = await client.post(
            f"/api/rooms/{room.id}/messages", headers=headers, json={"content": "hi"}
        )
        assert ok.status_code == 201

    blocked = await client.post(
        f"/api/rooms/{room.id}/messages", headers=headers, json={"content": "hi"}
    )
    assert blocked.status_code == 429
