"""Админский CRUD тарифов и привязка тарифа при создании участника (ARG-92)."""
import uuid

from httpx import AsyncClient

from .conftest import MakeUser, auth_headers, login


async def admin_headers(client: AsyncClient, make_user: MakeUser) -> dict[str, str]:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    return auth_headers(tokens["access_token"])


async def create_plan(
    client: AsyncClient, headers: dict[str, str], **overrides: object
) -> dict[str, object]:
    body = {"name": "Огонь", "price": 9000, "description": "тестовый тариф"}
    body.update(overrides)
    created = await client.post("/api/admin/plans", headers=headers, json=body)
    assert created.status_code == 201, created.text
    return dict(created.json())


async def test_non_admin_cannot_manage_plans(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    assert (await client.get("/api/admin/plans", headers=headers)).status_code == 403
    resp = await client.post(
        "/api/admin/plans",
        headers=headers,
        json={"name": "Вода", "price": 5000},
    )
    assert resp.status_code == 403


async def test_create_and_list_plans(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)

    plan = await create_plan(client, headers, name="Земля", price=12000)
    assert plan["is_active"] is True
    assert plan["price"] == 12000

    listed = await client.get("/api/admin/plans", headers=headers)
    assert listed.status_code == 200
    ids = [p["id"] for p in listed.json()]
    assert plan["id"] in ids


async def test_update_plan_price_and_deactivate(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    plan = await create_plan(client, headers)

    updated = await client.patch(
        f"/api/admin/plans/{plan['id']}",
        headers=headers,
        json={"price": 15000, "is_active": False},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["price"] == 15000
    assert body["is_active"] is False
    # name/description untouched by partial update
    assert body["name"] == plan["name"]


async def test_delete_plan(client: AsyncClient, make_user: MakeUser) -> None:
    headers = await admin_headers(client, make_user)
    plan = await create_plan(client, headers)

    deleted = await client.delete(f"/api/admin/plans/{plan['id']}", headers=headers)
    assert deleted.status_code == 204

    listed = await client.get("/api/admin/plans", headers=headers)
    assert plan["id"] not in [p["id"] for p in listed.json()]


async def test_delete_plan_in_use_conflicts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    plan = await create_plan(client, headers)
    intake = await client.get("/api/admin/intakes", headers=headers)
    intake_id = intake.json()[0]["id"]

    created_user = await client.post(
        "/api/admin/users",
        headers=headers,
        json={
            "username": f"plan_user_{uuid.uuid4().hex[:8]}",
            "display_name": "Plan User",
            "intake_id": intake_id,
            "plan_id": plan["id"],
        },
    )
    assert created_user.status_code == 201

    deleted = await client.delete(f"/api/admin/plans/{plan['id']}", headers=headers)
    assert deleted.status_code == 409


async def test_public_plans_list_includes_deactivated(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Деактивация тарифа (is_active=False) прячет его только из интейк-бота —
    участники, уже купившие его, не должны терять подпись группы «Дневники» на
    платформе (GET /api/plans используется именно для этой группировки)."""
    headers = await admin_headers(client, make_user)
    plan = await create_plan(client, headers)
    await client.patch(
        f"/api/admin/plans/{plan['id']}",
        headers=headers,
        json={"is_active": False},
    )

    participant = await make_user(role="participant", password="initpass123")
    tokens = await login(client, participant.username, "initpass123")
    participant_headers = auth_headers(tokens["access_token"])

    listed = await client.get("/api/plans", headers=participant_headers)
    assert listed.status_code == 200
    assert plan["id"] in [p["id"] for p in listed.json()]


async def test_create_user_with_unknown_plan_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    intake = await client.get("/api/admin/intakes", headers=headers)
    intake_id = intake.json()[0]["id"]

    resp = await client.post(
        "/api/admin/users",
        headers=headers,
        json={
            "username": f"bad_plan_user_{uuid.uuid4().hex[:8]}",
            "display_name": "Bad Plan",
            "intake_id": intake_id,
            "plan_id": 10**9,
        },
    )
    assert resp.status_code == 400
