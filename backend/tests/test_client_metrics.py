"""Тесты приёма клиентских метрик RUM (ARG-80).

Проверяем: трейс первого экрана раскладывается по разрезам «холодный/тёплый + тип
сети» и получает производный шаг `frontend` (= LCP − TTFB), сценарий открытия
комнаты и байты по типам медиа копятся отдельно, упавший экран оставляет запись с
версией сборки и роутом, свод закрыт от обычного пользователя, а приёмник остаётся
безобидным: битая пачка не роняет экран и мусорные значения не плодят ключи.
"""
import json

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.core.redis import redis_client

from .conftest import MakeUser, auth_headers, login


async def _clear_client_metric_keys() -> None:
    """Снести накопленные ключи клиентских метрик между прогонами."""
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor, match="metrics:client:*", count=200)
        if keys:
            await redis_client.delete(*keys)
        if cursor == 0:
            break


async def _headers(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    tokens = await login(client, username, password)
    return auth_headers(tokens["access_token"])


@pytest.fixture(autouse=True)
def _enable_client_metrics() -> None:
    settings.client_metrics_enabled = True


async def test_navigation_trace_split_by_cold_and_network(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Первый экран: разрезы холодный/тёплый и тип сети + производный шаг `frontend`."""
    await _clear_client_metric_keys()

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    resp = await client.post(
        "/api/metrics/client",
        headers=admin_h,
        json={
            "items": [
                {
                    "kind": "navigation",
                    "build": "20260816",
                    "net": "4g",
                    "cold": True,
                    "steps": {"dns": 12, "ttfb": 300, "dom_interactive": 800, "lcp": 1200},
                },
                {
                    "kind": "navigation",
                    "build": "20260816",
                    "net": "4g",
                    "cold": False,
                    "steps": {"ttfb": 120, "lcp": 400},
                },
            ]
        },
    )
    assert resp.status_code == 204, resp.text

    body = (await client.get("/api/metrics/client", headers=admin_h)).json()
    assert body["enabled"] is True
    first = body["first_screen"]
    assert first["cold:4g:ttfb"]["count"] == 1
    assert first["warm:4g:ttfb"]["count"] == 1
    assert first["cold:4g:lcp"]["count"] == 1
    # Разделитель ARG-15: сам фронт = LCP − TTFB, считается на приёме.
    assert first["cold:4g:frontend"]["count"] == 1
    for quantile in ("p50", "p90", "p99"):
        assert first["cold:4g:ttfb"][quantile] != "n/a"


async def test_room_open_and_media_bytes(client: AsyncClient, make_user: MakeUser) -> None:
    """Открытие комнаты видно по шагам; байты на повторном заходе считаются отдельно."""
    await _clear_client_metric_keys()

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    resp = await client.post(
        "/api/metrics/client",
        headers=admin_h,
        json={
            "items": [
                {
                    "kind": "room_open",
                    "build": "20260816",
                    "total_ms": 900,
                    "steps": {"request_ms": 400, "ttfb_ms": 250, "render_ms": 500},
                },
                {
                    "kind": "resources",
                    "build": "20260816",
                    "visit": "first",
                    "bytes": {"image": 4_000_000, "video": 1_000_000},
                },
                {
                    "kind": "resources",
                    "build": "20260816",
                    "visit": "repeat",
                    "bytes": {"image": 0, "video": 0},
                },
            ]
        },
    )
    assert resp.status_code == 204, resp.text

    body = (await client.get("/api/metrics/client", headers=admin_h)).json()
    scenarios = body["scenarios"]
    # Суффикс _ms в ключе агрегата не нужен — он не несёт смысла.
    assert scenarios["room_open:ttfb"]["count"] == 1
    assert scenarios["room_open:render"]["count"] == 1
    assert scenarios["room_open:total"]["count"] == 1

    byte_rows = body["bytes"]
    assert byte_rows["first:image"]["sum_bytes"] == 4_000_000
    assert byte_rows["repeat:image"]["sum_bytes"] == 0
    assert byte_rows["repeat:image"]["count"] == 1
    assert byte_rows["first:video"]["avg_bytes"] == 1_000_000


async def test_error_records_build_and_route(client: AsyncClient, make_user: MakeUser) -> None:
    """Упавший экран оставляет запись с версией сборки и роутом — и попадает в свод."""
    await _clear_client_metric_keys()

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    resp = await client.post(
        "/api/metrics/client",
        headers=admin_h,
        json={
            "items": [
                {
                    "kind": "error",
                    "build": "20260816",
                    "route": "/rooms/12",
                    "message": "TypeError: x is not a function",
                    "stack": "at Foo (index-abc.js:1:1)",
                }
            ]
        },
    )
    assert resp.status_code == 204, resp.text

    errors = (await client.get("/api/metrics/client", headers=admin_h)).json()["errors"]
    assert errors["counts"]["20260816 /rooms/12"] == 1
    assert errors["recent"][0]["message"].startswith("TypeError")
    assert errors["recent"][0]["build"] == "20260816"
    assert errors["recent"][0]["route"] == "/rooms/12"


async def test_hostile_values_do_not_break_keys(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Значения клиентские и не доверенные: длинные/с двоеточиями не ломают ключи Redis."""
    await _clear_client_metric_keys()

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    resp = await client.post(
        "/api/metrics/client",
        headers=admin_h,
        json={
            "items": [
                {
                    "kind": "navigation",
                    "net": "a:b:c" + "x" * 100,
                    "cold": True,
                    "steps": {"ttfb": 100},
                }
            ]
        },
    )
    assert resp.status_code == 204, resp.text

    body = (await client.get("/api/metrics/client", headers=admin_h)).json()
    keys = list(body["first_screen"])
    assert len(keys) == 1
    # Метка сети обрезана и без двоеточий → ключ остаётся из трёх частей.
    assert keys[0].count(":") == 2
    assert len(keys[0]) < 60


async def test_ingest_open_to_users_summary_admin_only(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Приём открыт активному пользователю, свод — только админу."""
    user = await make_user(password="userpass123")
    user_h = await _headers(client, user.username, "userpass123")

    resp = await client.post(
        "/api/metrics/client",
        headers=user_h,
        json={"items": [{"kind": "navigation", "steps": {"ttfb": 10}}]},
    )
    assert resp.status_code == 204, resp.text

    assert (await client.get("/api/metrics/client", headers=user_h)).status_code == 403
    assert (await client.post("/api/metrics/client", json={"items": []})).status_code == 401


async def test_disabled_collection_answers_204_and_writes_nothing(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Выключенный сбор не пишет ничего, но приёмник по-прежнему безобиден (204)."""
    await _clear_client_metric_keys()
    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    settings.client_metrics_enabled = False
    try:
        resp = await client.post(
            "/api/metrics/client",
            headers=admin_h,
            json={"items": [{"kind": "navigation", "steps": {"ttfb": 10}}]},
        )
        assert resp.status_code == 204
        body = (await client.get("/api/metrics/client", headers=admin_h)).json()
        assert body["enabled"] is False
        assert body["first_screen"] == {}
    finally:
        settings.client_metrics_enabled = True

    body = (await client.get("/api/metrics/client", headers=admin_h)).json()
    assert json.dumps(body["first_screen"]) == "{}", "при выключенном сборе ничего не записалось"
