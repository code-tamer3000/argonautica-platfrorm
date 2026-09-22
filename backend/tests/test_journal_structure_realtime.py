"""Обновление структуры дневника долетает до уже открытых клиентов (ARG-127).

Полноценного WS-теста (нет ни одного websocket-теста в сьюте, httpx не умеет WS)
не заводим — несоразмерно задаче. Вместо этого проверяем ровно то, что реально
менялось: `create_program`/`update_program`/`delete_program` шлют
`journal.structure_changed` через `after_commit` (значит — ПОСЛЕ успешного commit,
не раньше), ровно один раз на операцию. Доставка Redis→WS — готовая инфраструктура
(`presence` уже работает так же), её здесь не трогаем и не перепроверяем.
"""
from datetime import timedelta

from httpx import AsyncClient

import app.api.dynamics as dynamics_mod
from app.api.dynamics import _platform_today

from .conftest import MakeUser, auth_headers, login


def _future_date(offset_days: int) -> str:
    return (_platform_today() + timedelta(days=3650 + offset_days)).isoformat()


async def _admin_headers(client: AsyncClient, make_user: MakeUser) -> dict[str, str]:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    return auth_headers(tokens["access_token"])


async def test_create_update_delete_program_broadcast_structure_changed(
    client: AsyncClient, make_user: MakeUser, monkeypatch
) -> None:
    events: list[dict] = []

    async def fake_publish(event: dict) -> None:
        events.append(event)

    monkeypatch.setattr(dynamics_mod, "publish_journal_structure_changed", fake_publish)
    headers = await _admin_headers(client, make_user)
    starts_on = _future_date(400)

    created = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": starts_on,
            "title": None,
            "description": None,
            "sections": [{"key": "focus", "label": "Фокус"}],
        },
    )
    assert created.status_code == 201, created.text
    program_id = created.json()["id"]
    assert len(events) == 1
    assert events[0] == {"type": "journal.structure_changed"}

    updated = await client.patch(
        f"/api/admin/journal/programs/{program_id}",
        headers=headers,
        json={"title": "Переименовано"},
    )
    assert updated.status_code == 200, updated.text
    assert len(events) == 2
    assert events[1] == {"type": "journal.structure_changed"}

    deleted = await client.delete(
        f"/api/admin/journal/programs/{program_id}", headers=headers
    )
    assert deleted.status_code == 204, deleted.text
    assert len(events) == 3
    assert events[2] == {"type": "journal.structure_changed"}


async def test_failed_create_does_not_broadcast(
    client: AsyncClient, make_user: MakeUser, monkeypatch
) -> None:
    """Регрессия after_commit: упавший запрос (409 — дублирующая дата старта) не
    должен слать событие вообще — коммита не было."""
    events: list[dict] = []

    async def fake_publish(event: dict) -> None:
        events.append(event)

    monkeypatch.setattr(dynamics_mod, "publish_journal_structure_changed", fake_publish)
    headers = await _admin_headers(client, make_user)

    # Дата старта сид-задания уже занята → 409, до commit не доходит.
    resp = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": "2026-07-03",
            "title": None,
            "description": None,
            "sections": [{"key": "focus", "label": "Фокус"}],
        },
    )
    assert resp.status_code == 409, resp.text
    assert events == []
