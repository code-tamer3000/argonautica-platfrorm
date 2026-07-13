"""Тесты приёма и свода метрик медиа (измерительный слой, docs/FILES.md).

Приём открыт активному юзеру, свод — только админу. Проверяем: приём кладёт трейсы
в агрегаты Redis, свод считает count/перцентили, чужой к своду не допущен, а при
выключенном сборе приём тихо отвечает 204 и ничего не копит.
"""
from httpx import AsyncClient

from app.core.config import settings
from app.core.redis import redis_client

from .conftest import MakeUser, auth_headers, login


async def _clear_metric_keys() -> None:
    """Снести накопленные ключи метрик, чтобы тесты не зависели от прошлых прогонов."""
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor, match="metrics:media:*", count=200)
        if keys:
            await redis_client.delete(*keys)
        if cursor == 0:
            break


async def _headers(client: AsyncClient, user_name: str, password: str) -> dict[str, str]:
    tokens = await login(client, user_name, password)
    return auth_headers(tokens["access_token"])


async def test_ingest_records_aggregates_and_summary(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await _clear_metric_keys()
    settings.media_metrics_enabled = True

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    # Юзер шлёт пачку трейсов загрузки картинки.
    resp = await client.post(
        "/api/metrics/media",
        headers=admin_h,
        json={
            "items": [
                {
                    "op": "upload",
                    "kind": "image",
                    "size": 123456,
                    "net": "4g",
                    "total_ms": 8421,
                    "steps": {"presign_ms": 90, "put_ms": 8100, "confirm_ms": 200},
                },
                {
                    "op": "upload",
                    "kind": "image",
                    "total_ms": 3000,
                    "steps": {"presign_ms": 50, "put_ms": 2800, "confirm_ms": 150},
                },
            ]
        },
    )
    assert resp.status_code == 204

    # Свод (админ) видит агрегаты по шагам.
    summary = await client.get("/api/metrics/media", headers=admin_h)
    assert summary.status_code == 200
    body = summary.json()
    assert body["enabled"] is True
    steps = body["steps"]
    # Клиентский шаг put для upload/image накопился по двум событиям.
    assert "client:upload:image:put" in steps
    put = steps["client:upload:image:put"]
    assert put["count"] == 2
    # Средняя длительность put — между 2800 и 8100.
    assert 2800 <= put["avg_ms"] <= 8100
    # Перцентили — метки бакетов (строки), присутствуют.
    assert set(put.keys()) >= {"count", "avg_ms", "p50", "p90", "p99"}
    # Полная длительность как отдельный шаг total.
    assert "client:upload:image:total" in steps


async def test_summary_forbidden_for_non_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    user_h = await _headers(client, user.username, "initpass123")
    resp = await client.get("/api/metrics/media", headers=user_h)
    assert resp.status_code == 403


async def test_ingest_requires_auth(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/metrics/media",
        json={"items": [{"op": "upload", "kind": "image", "total_ms": 10, "steps": {}}]},
    )
    assert resp.status_code in (401, 403)


async def test_disabled_metrics_ingest_is_noop(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await _clear_metric_keys()
    settings.media_metrics_enabled = False
    try:
        user = await make_user(role="participant", password="initpass123")
        user_h = await _headers(client, user.username, "initpass123")
        resp = await client.post(
            "/api/metrics/media",
            headers=user_h,
            json={
                "items": [
                    {"op": "download", "kind": "video", "total_ms": 5000, "steps": {"load_ms": 5000}}
                ]
            },
        )
        assert resp.status_code == 204
        # Ничего не накопилось: ключей метрик нет.
        cursor, keys = await redis_client.scan(0, match="metrics:media:*", count=200)
        assert keys == []
    finally:
        settings.media_metrics_enabled = True
