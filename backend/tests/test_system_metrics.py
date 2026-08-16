"""Тесты снимка инфраструктуры `GET /api/metrics/system` (измерительный слой, ARG-81).

Реальные Postgres/Redis тестового стека, без моков. Проверяем: снимок отдаётся админу,
закрыт обычному юзеру, на пустой очереди даёт нули (а не падает), а застрявшая джоба
транскода и джоба с повторами видны отдельными числами.
"""
import time
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import AsyncClient

from app.core.config import settings
from app.core.redis import redis_client
from app.services import transcode_queue as q
from app.services.system_metrics import DISK_BASELINE_KEY

from .conftest import MakeUser, auth_headers, login


@pytest_asyncio.fixture(autouse=True)
async def _clean_keys() -> AsyncIterator[None]:
    """Состояние в Redis эфемерно и общее для всего набора — чистим до и после."""
    keys = (q.PENDING_KEY, q.INFLIGHT_KEY, q.ATTEMPTS_KEY, DISK_BASELINE_KEY)
    await redis_client.delete(*keys)
    yield
    await redis_client.delete(*keys)


async def _headers(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    tokens = await login(client, username, password)
    return auth_headers(tokens["access_token"])


async def test_snapshot_on_empty_queue_is_zeros_not_error(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = await _headers(client, admin.username, "adminpass123")

    resp = await client.get("/api/metrics/system", headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    # Все блоки на месте и ни один не свалился в {"error": ...}.
    assert set(body) >= {"ts", "transcode_queue", "presence", "db_pool", "redis", "disk"}
    for block in ("transcode_queue", "presence", "db_pool", "redis", "disk"):
        assert "error" not in body[block], f"{block}: {body[block]}"

    # Пустая очередь — нули, а не падение.
    queue = body["transcode_queue"]
    assert queue["pending"] == 0
    assert queue["inflight"] == 0
    assert queue["stale"] == 0
    assert queue["retrying"] == 0
    assert queue["claim_timeout_seconds"] == settings.transcode_claim_timeout_seconds

    # Онлайн: множество presence + локальные WS-соединения процесса.
    assert body["presence"]["online_users"] >= 0
    assert body["presence"]["ws_connections_this_process"] >= 0

    # Пул БД: под нагрузкой запроса минимум одно соединение существует.
    pool = body["db_pool"]
    assert pool["size_is_sqlalchemy_default"] is True
    assert isinstance(pool["status"], str) and pool["status"]
    assert pool["checked_out"] >= 0

    # Redis: PING отвечает, память видна.
    assert body["redis"]["ping_ms"] >= 0
    assert body["redis"]["used_memory_bytes"] > 0

    # Диск: свободное место под медиа.
    disk = body["disk"]
    assert disk["total_bytes"] > 0
    assert disk["free_bytes"] > 0
    assert 0 <= disk["used_percent"] <= 100
    # Базовой точки не было → скорость роста честно null, а не выдуманный ноль.
    assert disk["growth_bytes_per_hour"] is None


async def test_stuck_and_retrying_jobs_are_separate_numbers(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = await _headers(client, admin.username, "adminpass123")

    # Две джобы ждут в очереди.
    await q.enqueue(101)
    await q.enqueue(102)
    # Одна забрана только что (живая), одна — давно (воркер упал → застряла).
    await redis_client.hset(q.INFLIGHT_KEY, "201", str(time.time()))
    await redis_client.hset(
        q.INFLIGHT_KEY,
        "202",
        str(time.time() - settings.transcode_claim_timeout_seconds - 60),
    )
    # Одна джоба идёт по второму кругу, другая — по первому.
    await redis_client.hset(q.ATTEMPTS_KEY, "202", "2")
    await redis_client.hset(q.ATTEMPTS_KEY, "201", "1")

    body = (await client.get("/api/metrics/system", headers=headers)).json()
    queue = body["transcode_queue"]
    assert queue["pending"] == 2
    assert queue["inflight"] == 2
    # Застрявшая видна отдельным числом, а не выводится глазами из логов.
    assert queue["stale"] == 1
    assert queue["retrying"] == 1
    assert queue["oldest_claim_age_seconds"] > settings.transcode_claim_timeout_seconds


async def test_disk_growth_rate_computed_from_previous_snapshot(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = await _headers(client, admin.username, "adminpass123")

    # Базовая точка часовой давности: «занято на 3600 байт меньше» → рост 3600 б/ч.
    await redis_client.hset(
        DISK_BASELINE_KEY,
        mapping={"used_bytes": "0", "ts": str(time.time() - 3600)},
    )

    disk = (await client.get("/api/metrics/system", headers=headers)).json()["disk"]
    assert disk["growth_bytes_per_hour"] is not None
    assert disk["growth_window_seconds"] >= 3600
    # База старше минимального интервала → сдвинута на текущий снимок.
    stored = await redis_client.hgetall(DISK_BASELINE_KEY)
    assert int(stored["used_bytes"]) == disk["used_bytes"]


async def test_snapshot_forbidden_for_non_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    headers = await _headers(client, user.username, "initpass123")
    resp = await client.get("/api/metrics/system", headers=headers)
    assert resp.status_code == 403


async def test_snapshot_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/api/metrics/system")
    assert resp.status_code in (401, 403)
