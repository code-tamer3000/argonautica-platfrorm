"""Структура дневника: версии-задания, посуточная оценка и админ-CRUD.

journal_programs — ГЛОБАЛЬНОЕ состояние (одна шкала на всю платформу), а тестовая
БД переживает прогоны. Поэтому:
- логику подсчёта проверяем на чистых функциях (без БД);
- интеграционные тесты создают задания с датой старта В БУДУЩЕМ (не влияет на оценку
  сегодняшних/прошлых дней) и убирают их за собой.
"""
from datetime import timedelta

from httpx import AsyncClient

from app.api.dynamics import (
    ProgramVersion,
    _calc_stats,
    _platform_today,
    active_version_for,
    required_keys_for,
)

from .conftest import MakeUser, auth_headers, login


# ─── Чистая логика шкалы заданий ────────────────────────────────────────────

def _timeline():
    today = _platform_today()
    start = today - timedelta(days=10)
    boundary = today - timedelta(days=5)
    return start, boundary, [
        ProgramVersion(starts_on=start, keys=frozenset({"a", "b"}), order={"a": 0, "b": 1}),
        ProgramVersion(
            starts_on=boundary, keys=frozenset({"a", "b", "c"}), order={"a": 0, "b": 1, "c": 2}
        ),
    ]


def test_required_keys_switch_at_boundary() -> None:
    start, boundary, timeline = _timeline()
    # До границы действует старое задание, с границы — новое.
    assert required_keys_for(start, timeline) == frozenset({"a", "b"})
    assert required_keys_for(boundary - timedelta(days=1), timeline) == frozenset({"a", "b"})
    assert required_keys_for(boundary, timeline) == frozenset({"a", "b", "c"})
    # До первого задания — пусто.
    assert required_keys_for(start - timedelta(days=1), timeline) == frozenset()
    assert active_version_for(start - timedelta(days=1), timeline) is None


def test_calc_stats_scores_each_day_by_its_active_program() -> None:
    start, boundary, timeline = _timeline()
    before = boundary - timedelta(days=1)  # задание {a,b}
    after = boundary + timedelta(days=1)   # задание {a,b,c}
    per_day = {
        before: {"a", "b"},          # закрыт по старому заданию
        after: {"a", "b"},           # НЕ закрыт — новому нужен ещё "c"
    }
    stats = _calc_stats(per_day, pardons=[], program_start=start, timeline=timeline)
    assert before in stats["closed_days"]
    assert after not in stats["closed_days"]

    # Добавление раздела "c" с границы НЕ ломает уже закрытый день до границы.
    per_day2 = {before: {"a", "b"}, after: {"a", "b", "c"}}
    stats2 = _calc_stats(per_day2, pardons=[], program_start=start, timeline=timeline)
    assert before in stats2["closed_days"]
    assert after in stats2["closed_days"]


# ─── Эндпоинт структуры (участник) ──────────────────────────────────────────

async def test_structure_returns_seeded_active_program(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get(
        "/api/dynamics/structure", headers=auth_headers(tokens["access_token"])
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Сид миграции — задание #1 с разделами focus/notes/film.
    keys = [s["key"] for s in data["sections"]]
    assert keys == ["focus", "notes", "film"]
    film = next(s for s in data["sections"] if s["key"] == "film")
    assert film["input_type"] == "title"


# ─── Админ-CRUD заданий ─────────────────────────────────────────────────────

def _future_date(offset_days: int) -> str:
    return (_platform_today() + timedelta(days=3650 + offset_days)).isoformat()


async def test_admin_create_list_delete_program(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])
    starts_on = _future_date(1)

    created = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": starts_on,
            "title": "Будущее задание",
            "description": None,
            "sections": [
                {"key": "focus", "label": "Фокус", "emoji": "🎯"},
                {"key": "gratitude", "label": "Благодарность", "emoji": "🙏"},
            ],
        },
    )
    assert created.status_code == 201, created.text
    program_id = created.json()["id"]
    try:
        # Позиции проставляются по порядку списка.
        assert [s["position"] for s in created.json()["sections"]] == [0, 1]

        listed = await client.get("/api/admin/journal/programs", headers=headers)
        assert listed.status_code == 200
        assert any(p["id"] == program_id for p in listed.json())
    finally:
        deleted = await client.delete(
            f"/api/admin/journal/programs/{program_id}", headers=headers
        )
        assert deleted.status_code == 204

    gone = await client.get("/api/admin/journal/programs", headers=headers)
    assert all(p["id"] != program_id for p in gone.json())


async def test_create_duplicate_start_conflicts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])
    # Дата старта сид-задания уже занята → 409.
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


async def test_cannot_delete_earliest_program(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])
    programs = (await client.get("/api/admin/journal/programs", headers=headers)).json()
    earliest = min(programs, key=lambda p: p["starts_on"])
    resp = await client.delete(
        f"/api/admin/journal/programs/{earliest['id']}", headers=headers
    )
    assert resp.status_code == 400, resp.text


async def test_create_validation_rejects_bad_input(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = auth_headers((await login(client, admin.username, "adminpass123"))["access_token"])

    async def _post(sections: list[dict]) -> int:
        r = await client.post(
            "/api/admin/journal/programs",
            headers=headers,
            json={
                "starts_on": _future_date(50),
                "title": None,
                "description": None,
                "sections": sections,
            },
        )
        return r.status_code

    assert await _post([]) == 422  # без разделов
    assert await _post([{"key": "Bad Key", "label": "X"}]) == 422  # ключ не slug
    assert (
        await _post([{"key": "a", "label": "A"}, {"key": "a", "label": "B"}]) == 422
    )  # дубль ключа


async def test_non_admin_cannot_manage_programs(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    headers = auth_headers((await login(client, user.username, "initpass123"))["access_token"])
    assert (await client.get("/api/admin/journal/programs", headers=headers)).status_code == 403
    created = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": _future_date(99),
            "title": None,
            "description": None,
            "sections": [{"key": "focus", "label": "Фокус"}],
        },
    )
    assert created.status_code == 403
