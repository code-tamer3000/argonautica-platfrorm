"""Тесты экспорта Prometheus (`GET /metrics`, ARG-82).

Проверяем: эндпоинт открыт без авторизации (нужен только скрейперу внутри сети),
не под `/api`-префиксом, кумулятивные бакеты гистограмм строятся правильно, и
итоговые числа сходятся с тем же самым админским сводом (`/api/metrics/http`) —
оба читают одни и те же ключи Redis, поэтому расхождения быть не должно.
"""
from httpx import AsyncClient

from app.core.config import settings
from app.core.redis import redis_client

from .conftest import MakeUser, auth_headers, login


async def _clear_metric_keys() -> None:
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor, match="metrics:*", count=200)
        if keys:
            await redis_client.delete(*keys)
        if cursor == 0:
            break


async def _headers(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    tokens = await login(client, username, password)
    return auth_headers(tokens["access_token"])


async def test_metrics_endpoint_no_auth_required(client: AsyncClient) -> None:
    """`/metrics` не требует авторизации — доступ ограничен топологией сети, не auth."""
    resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")


async def test_metrics_not_under_api_prefix(client: AsyncClient) -> None:
    """Эндпоинт живёт на корне, а не `/api/metrics` — чтобы не путать с админским сводом."""
    resp = await client.get("/api/metrics")
    assert resp.status_code == 404


async def test_http_histogram_cumulative_and_matches_admin_summary(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Бакеты `/metrics` кумулятивны и число сэмплов сходится со сводом `/api/metrics/http`."""
    await _clear_metric_keys()
    settings.http_metrics_enabled = True

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    await client.get("/api/auth/me", headers=admin_h)
    await client.get("/api/auth/me", headers=admin_h)

    summary = (await client.get("/api/metrics/http", headers=admin_h)).json()
    expected_count = summary["routes"]["GET:/api/auth/me"]["count"]

    text = (await client.get("/metrics")).text
    lines = [
        line
        for line in text.splitlines()
        if line.startswith("http_request_duration_ms_bucket")
        and 'route="/api/auth/me"' in line
        and 'method="GET"' in line
    ]
    assert lines, "гистограмма для GET /api/auth/me должна попасть в экспорт"

    buckets = []
    for line in lines:
        le = line.split('le="', 1)[1].split('"', 1)[0]
        value = int(line.rsplit(" ", 1)[1])
        buckets.append((float("inf") if le == "+Inf" else float(le), value))
    buckets.sort()

    # Кумулятивность: значение бакета никогда не убывает с ростом границы.
    for (_, prev), (_, nxt) in zip(buckets, buckets[1:]):
        assert nxt >= prev
    # +Inf-бакет — это весь count, и он совпадает с тем, что отдаёт админский свод.
    assert buckets[-1][1] == expected_count

    count_line = next(
        line
        for line in text.splitlines()
        if line.startswith("http_request_duration_ms_count")
        and 'route="/api/auth/me"' in line
    )
    assert int(count_line.rsplit(" ", 1)[1]) == expected_count


async def test_system_gauges_are_numeric_lines(client: AsyncClient) -> None:
    """Инфраструктурные гейджи (очередь транскода, онлайн, redis, диск) попадают в экспорт."""
    text = (await client.get("/metrics")).text
    assert "system_presence_online_users " in text
    assert "system_transcode_queue_pending " in text
    assert "system_redis_ping_ms " in text


async def test_metrics_disabled_sections_are_omitted(client: AsyncClient) -> None:
    """Выключенный сбор (`*_metrics_enabled = False`) не отдаёт свои серии вовсе."""
    settings.http_metrics_enabled = False
    try:
        text = (await client.get("/metrics")).text
        assert "http_request_duration_ms_bucket" not in text
    finally:
        settings.http_metrics_enabled = True


async def test_metrics_empty_state_is_valid_empty_body(client: AsyncClient) -> None:
    """Пустая Redis-агрегация (никто ничего не собирал) — пустой/почти пустой текст, не ошибка."""
    await _clear_metric_keys()
    settings.http_metrics_enabled = False
    settings.media_metrics_enabled = False
    settings.client_metrics_enabled = False
    try:
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        # Гейджи всё равно есть (system всегда включён), но никакой гистограммы.
        assert "_bucket{" not in resp.text
    finally:
        settings.http_metrics_enabled = True
        settings.media_metrics_enabled = True
        settings.client_metrics_enabled = True
