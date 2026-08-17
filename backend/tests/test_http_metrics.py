"""Тесты серверного слоя наблюдаемости (ObservabilityMiddleware, ARG-79).

Проверяем: сквозной request_id доходит до клиента заголовком, тайминги и статусы
копятся по ШАБЛОНУ роута (а не по подставленному пути), именованные сценарии
считаются отдельно, свод закрыт от обычного пользователя — и, отдельным
регрессионным тестом, что текст сообщения не утекает в структурный лог.
"""
import json
import logging
from collections.abc import Iterator

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.core.metrics import metrics_logger
from app.core.redis import redis_client

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _clear_http_metric_keys() -> None:
    """Снести накопленные ключи HTTP-метрик — прогоны не должны влиять друг на друга."""
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor, match="metrics:http:*", count=200)
        if keys:
            await redis_client.delete(*keys)
        if cursor == 0:
            break


async def _headers(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    tokens = await login(client, username, password)
    return auth_headers(tokens["access_token"])


@pytest.fixture
def captured_logs() -> Iterator[list[str]]:
    """Собрать строки, ушедшие в логгер метрик.

    Свой handler, а не caplog: у `app.metrics` выключен propagate (см. core/metrics.py),
    поэтому корневой перехватчик pytest его записей не видит.
    """
    lines: list[str] = []

    class _Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(record.getMessage())

    handler = _Collector()
    metrics_logger.addHandler(handler)
    try:
        yield lines
    finally:
        metrics_logger.removeHandler(handler)


async def test_request_id_returned_and_incoming_one_reused(client: AsyncClient) -> None:
    """Идентификатор запроса всегда возвращается; присланный клиентом — переиспользуется."""
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    generated = resp.headers.get("x-request-id")
    assert generated, "middleware обязан вернуть x-request-id"

    resp = await client.get("/api/health", headers={"X-Request-ID": "trace-me-42"})
    assert resp.headers["x-request-id"] == "trace-me-42"


async def test_summary_counts_routes_scenarios_and_statuses(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Свод считает запросы по шаблону роута, статусы и именованные сценарии."""
    await _clear_http_metric_keys()
    settings.http_metrics_enabled = True

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    await client.get("/api/auth/me", headers=admin_h)
    await client.get("/api/auth/me", headers=admin_h)

    resp = await client.get("/api/metrics/http", headers=admin_h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["enabled"] is True

    row = body["routes"]["GET:/api/auth/me"]
    assert row["count"] >= 2
    assert row["statuses"]["2xx"] >= 2
    assert row["error_rate"] == 0.0
    for quantile in ("p50", "p90", "p99"):
        assert row[quantile] != "n/a"

    # Логин из хелпера — именованный сценарий, считается отдельно от общей массы.
    assert body["scenarios"]["login"]["count"] >= 1


async def test_route_template_not_concrete_path(
    client: AsyncClient, make_user: MakeUser, make_room: MakeRoom, add_membership: AddMembership
) -> None:
    """Ключ метрики — шаблон с {room_id}, иначе кардинальность растёт с числом комнат."""
    await _clear_http_metric_keys()
    settings.http_metrics_enabled = True

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")
    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id)

    await client.get(f"/api/rooms/{room.id}/messages", headers=admin_h)

    body = (await client.get("/api/metrics/http", headers=admin_h)).json()
    assert "GET:/api/rooms/{room_id}/messages" in body["routes"]
    assert f"/api/rooms/{room.id}/messages" not in json.dumps(body)
    # Открытие комнаты — именованный сценарий из ARG-15.
    assert body["scenarios"]["room_open"]["count"] >= 1


async def test_unmatched_path_collapses_to_single_key(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Несуществующие пути не плодят ключи: все схлопываются в один шаблон."""
    await _clear_http_metric_keys()
    settings.http_metrics_enabled = True

    admin = await make_user(role="admin", password="adminpass123")
    admin_h = await _headers(client, admin.username, "adminpass123")

    await client.get("/api/no-such-thing-1")
    await client.get("/api/no-such-thing-2")

    body = (await client.get("/api/metrics/http", headers=admin_h)).json()
    assert body["routes"]["GET:<unmatched>"]["count"] >= 2
    assert "no-such-thing" not in json.dumps(body)


async def test_summary_is_admin_only(client: AsyncClient, make_user: MakeUser) -> None:
    """Свод — админский: обычному активному пользователю закрыт."""
    user = await make_user(password="userpass123")
    user_h = await _headers(client, user.username, "userpass123")

    resp = await client.get("/api/metrics/http", headers=user_h)
    assert resp.status_code == 403


async def test_message_text_never_reaches_logs(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    captured_logs: list[str],
) -> None:
    """Регресс приватности: тело сообщения не должно попасть ни в одну лог-строку.

    Белый список полей в `log_structured` — единственный вход для записей запроса,
    поэтому текст сообщения физически не имеет туда дороги. Тест сторожит именно это.
    """
    settings.http_metrics_enabled = True
    marker = "секретный-маркер-каюты-9f3a"

    author = await make_user(password="userpass123")
    author_h = await _headers(client, author.username, "userpass123")
    room = await make_room(created_by=author.id)
    await add_membership(room.id, author.id)

    resp = await client.post(
        f"/api/rooms/{room.id}/messages", headers=author_h, json={"content": marker}
    )
    assert resp.status_code == 201, resp.text

    assert captured_logs, "структурный лог запроса должен был появиться"
    joined = "\n".join(captured_logs)
    assert marker not in joined

    # Заодно: строка про этот запрос есть, она разобрана как JSON и несёт request_id.
    records = [json.loads(line) for line in captured_logs if line.startswith("{")]
    requests = [r for r in records if r.get("event") == "http_request"]
    assert requests, "на каждый запрос должна быть ровно одна структурная строка"
    assert all(r.get("request_id") for r in requests)
