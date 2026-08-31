"""Админский CRUD наборов и фильтрация участников по набору (ARG-89)."""
import uuid
from datetime import date, timedelta

from httpx import AsyncClient

from .conftest import MakeUser, auth_headers, login


async def admin_headers(client: AsyncClient, make_user: MakeUser) -> dict[str, str]:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    return auth_headers(tokens["access_token"])


async def free_starts_on(client: AsyncClient, headers: dict[str, str]) -> date:
    """Дата старта, которой ещё нет ни у одного набора.

    Тестовая БД переживает прогоны, а `intakes.starts_on` UNIQUE — фиксированная дата
    вроде `today + 365` падает в 409 на втором запуске. Берём день после самого позднего
    существующего набора: дата уникальна, и созданный набор гарантированно активный
    (максимальная `starts_on`, то есть первый в списке).
    """
    listed = await client.get("/api/admin/intakes", headers=headers)
    assert listed.status_code == 200
    existing = [date.fromisoformat(i["starts_on"]) for i in listed.json()]
    return max(existing, default=date.today()) + timedelta(days=1)


async def create_intake(
    client: AsyncClient, headers: dict[str, str]
) -> dict[str, object]:
    """Создать набор на свободную дату и вернуть его тело ответа."""
    starts_on = await free_starts_on(client, headers)
    ends_on = starts_on + timedelta(days=28)
    created = await client.post(
        "/api/admin/intakes",
        headers=headers,
        json={"starts_on": starts_on.isoformat(), "ends_on": ends_on.isoformat()},
    )
    assert created.status_code == 201, created.text
    return dict(created.json())


async def test_non_admin_cannot_list_or_create_intakes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    assert (await client.get("/api/admin/intakes", headers=headers)).status_code == 403
    resp = await client.post(
        "/api/admin/intakes", headers=headers, json={"starts_on": "2030-01-01"}
    )
    assert resp.status_code == 403


async def test_create_intake_and_list_sorted_desc(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Созданный набор появляется в списке, свежие сверху, у нового 0 участников."""
    headers = await admin_headers(client, make_user)

    starts_on = await free_starts_on(client, headers)
    ends_on = starts_on + timedelta(days=28)
    created = await client.post(
        "/api/admin/intakes",
        headers=headers,
        json={"starts_on": starts_on.isoformat(), "ends_on": ends_on.isoformat()},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["starts_on"] == starts_on.isoformat()
    assert body["ends_on"] == ends_on.isoformat()
    assert body["user_count"] == 0
    assert body["created_at"]

    listed = await client.get("/api/admin/intakes", headers=headers)
    assert listed.status_code == 200
    intakes = listed.json()
    # Свежий набор — активный: максимальная starts_on, значит первый в списке.
    assert intakes[0]["id"] == body["id"]
    dates = [i["starts_on"] for i in intakes]
    assert dates == sorted(dates, reverse=True)
    # У набора, куда fixture положила админа, счётчик ненулевой.
    assert any(i["user_count"] > 0 for i in intakes)


async def test_create_intake_duplicate_date_conflicts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    starts_on = await free_starts_on(client, headers)
    body = {
        "starts_on": starts_on.isoformat(),
        "ends_on": (starts_on + timedelta(days=28)).isoformat(),
    }

    first = await client.post("/api/admin/intakes", headers=headers, json=body)
    assert first.status_code == 201
    second = await client.post("/api/admin/intakes", headers=headers, json=body)
    assert second.status_code == 409


async def test_create_user_requires_existing_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Набор обязателен при создании участника и должен существовать."""
    headers = await admin_headers(client, make_user)

    missing_field = await client.post(
        "/api/admin/users",
        headers=headers,
        json={"username": f"u_{uuid.uuid4().hex[:8]}", "display_name": "No Intake"},
    )
    assert missing_field.status_code == 422

    unknown_intake = await client.post(
        "/api/admin/users",
        headers=headers,
        json={
            "username": f"u_{uuid.uuid4().hex[:8]}",
            "display_name": "Bad Intake",
            "intake_id": 10**9,
        },
    )
    assert unknown_intake.status_code == 400


async def test_users_carry_intake_and_filter_by_it(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """GET /api/admin/users отдаёт набор участника и фильтруется по intake_id."""
    headers = await admin_headers(client, make_user)
    other_starts_on = date.today() - timedelta(days=200)
    other = await make_user(role="participant", intake_starts_on=other_starts_on)

    intake_id = (await create_intake(client, headers))["id"]

    username = f"u_{uuid.uuid4().hex[:8]}"
    created_user = await client.post(
        "/api/admin/users",
        headers=headers,
        json={
            "username": username,
            "display_name": "Fresh Intake",
            "intake_id": intake_id,
        },
    )
    assert created_user.status_code == 201
    new_user_id = created_user.json()["id"]

    # Без фильтра — все, с датой старта набора рядом с участником.
    everyone = await client.get("/api/admin/users", headers=headers)
    assert everyone.status_code == 200
    rows = {u["id"]: u for u in everyone.json()}
    assert rows[new_user_id]["intake_id"] == intake_id
    assert rows[other.id]["intake_starts_on"] == other_starts_on.isoformat()

    # С фильтром — только участники указанного набора.
    filtered = await client.get(
        "/api/admin/users", headers=headers, params={"intake_id": intake_id}
    )
    assert filtered.status_code == 200
    ids = [u["id"] for u in filtered.json()]
    assert ids == [new_user_id]
    assert other.id not in ids


async def test_patch_user_moves_between_intakes(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    participant = await make_user(role="participant")

    intake_id = (await create_intake(client, headers))["id"]
    assert intake_id != participant.intake_id

    moved = await client.patch(
        f"/api/admin/users/{participant.id}",
        headers=headers,
        json={"intake_id": intake_id},
    )
    assert moved.status_code == 200

    filtered = await client.get(
        "/api/admin/users", headers=headers, params={"intake_id": intake_id}
    )
    assert [u["id"] for u in filtered.json()] == [participant.id]

    # Оставить участника вовсе без набора нельзя — набор обязателен.
    unset = await client.patch(
        f"/api/admin/users/{participant.id}", headers=headers, json={"intake_id": None}
    )
    assert unset.status_code == 400

    # Несуществующий набор тоже отбиваем.
    bad = await client.patch(
        f"/api/admin/users/{participant.id}",
        headers=headers,
        json={"intake_id": 10**9},
    )
    assert bad.status_code == 400


# --- Круг Экспедиции: расписание этапов (intake_stages) --------------------


def _six_stages(start: date) -> list[dict[str, object]]:
    kinds_offsets = (
        ("balance", 0), ("air", 4), ("fire", 10), ("water", 16), ("earth", 21), ("final", 27),
    )
    return [
        {"kind": kind, "air_date": (start + timedelta(days=off)).isoformat()}
        for kind, off in kinds_offsets
    ]


async def test_intake_stages_empty_before_configured(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    intake_id = (await create_intake(client, headers))["id"]

    resp = await client.get(f"/api/admin/intakes/{intake_id}/stages", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


async def test_intake_stages_put_and_replace(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    intake_id = (await create_intake(client, headers))["id"]
    start = date.today()

    put = await client.put(
        f"/api/admin/intakes/{intake_id}/stages",
        headers=headers,
        json={"stages": _six_stages(start)},
    )
    assert put.status_code == 200, put.text
    kinds = [s["kind"] for s in put.json()]
    assert kinds == ["balance", "air", "fire", "water", "earth", "final"]

    # Повторный PUT заменяет расписание целиком, а не плодит строки.
    shifted = await client.put(
        f"/api/admin/intakes/{intake_id}/stages",
        headers=headers,
        json={"stages": _six_stages(start + timedelta(days=1))},
    )
    assert shifted.status_code == 200
    listed = await client.get(f"/api/admin/intakes/{intake_id}/stages", headers=headers)
    rows = listed.json()
    assert len(rows) == 6
    assert rows[0]["air_date"] == (start + timedelta(days=1)).isoformat()


async def test_intake_stages_requires_all_six_kinds_once(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    intake_id = (await create_intake(client, headers))["id"]
    stages = _six_stages(date.today())[:5]  # только пять — не все стихии

    resp = await client.put(
        f"/api/admin/intakes/{intake_id}/stages",
        headers=headers,
        json={"stages": stages},
    )
    assert resp.status_code == 422  # min_length=6 на схеме


async def test_intake_stages_rejects_out_of_order_dates(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    intake_id = (await create_intake(client, headers))["id"]
    stages = _six_stages(date.today())
    # Огонь раньше Воздуха — нарушает порядок STAGE_KINDS.
    stages[2]["air_date"] = stages[1]["air_date"]

    resp = await client.put(
        f"/api/admin/intakes/{intake_id}/stages",
        headers=headers,
        json={"stages": stages},
    )
    assert resp.status_code == 400


async def test_intake_stages_rejects_unknown_task(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    intake_id = (await create_intake(client, headers))["id"]
    stages = _six_stages(date.today())
    stages[1]["task_id"] = 10**9  # заведомо не существует

    resp = await client.put(
        f"/api/admin/intakes/{intake_id}/stages",
        headers=headers,
        json={"stages": stages},
    )
    assert resp.status_code == 400
