"""Веб-воронка приёма — GET /api/admin/applications (ARG-107, read-only CRM)."""
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake_application import IntakeApplication
from app.models.plan import Plan
from app.schemas.intake_application import FUNNEL_STATUSES

from .conftest import MakeUser, auth_headers, login


async def admin_headers(client: AsyncClient, make_user: MakeUser) -> dict[str, str]:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    return auth_headers(tokens["access_token"])


def _next_tg_id() -> int:
    # tg_id UNIQUE — тестовая БД переживает прогоны, берём из монотонного времени.
    return int(datetime.now(UTC).timestamp() * 1000) % 1_000_000_000


async def test_non_admin_forbidden(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    resp = await client.get("/api/admin/applications", headers=headers)
    assert resp.status_code == 403


async def test_unauthenticated_rejected(client: AsyncClient) -> None:
    resp = await client.get("/api/admin/applications")
    assert resp.status_code == 401


async def test_empty_by_status_has_all_seven_keys(
    client: AsyncClient, make_user: MakeUser
) -> None:
    headers = await admin_headers(client, make_user)
    resp = await client.get("/api/admin/applications", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["by_status"].keys()) == set(FUNNEL_STATUSES)
    assert body["total"] == sum(body["by_status"].values())


async def test_stages_counted_stage_since_and_days_in_stage(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    headers = await admin_headers(client, make_user)

    plan = Plan(name="Тестовый тариф", price=9000, description="", is_active=True)
    session.add(plan)
    await session.flush()

    week_ago = datetime.now(UTC) - timedelta(days=5)
    submitted_app = IntakeApplication(
        tg_id=_next_tg_id(),
        tg_username="submitted_user",
        status="submitted",
        about="Расскажу о себе",
        submitted_at=week_ago,
    )
    confirmed_app = IntakeApplication(
        tg_id=_next_tg_id(),
        tg_first_name="Имя",
        tg_last_name="Фамилия",
        status="confirmed",
        plan_id=plan.id,
        receipt_file_id="file123",
        receipt_kind="photo",
        confirmed_at=datetime.now(UTC),
    )
    session.add_all([submitted_app, confirmed_app])
    await session.commit()

    resp = await client.get("/api/admin/applications", headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    assert body["by_status"]["submitted"] >= 1
    assert body["by_status"]["confirmed"] >= 1

    by_id = {item["id"]: item for item in body["items"]}
    submitted_out = by_id[submitted_app.id]
    assert submitted_out["stage_since"] is not None
    assert submitted_out["days_in_stage"] == 5
    assert submitted_out["plan_name"] is None
    assert submitted_out["plan_price"] is None
    assert submitted_out["has_receipt"] is False

    confirmed_out = by_id[confirmed_app.id]
    assert confirmed_out["plan_name"] == "Тестовый тариф"
    assert confirmed_out["plan_price"] == 9000
    assert confirmed_out["has_receipt"] is True
    assert confirmed_out["receipt_kind"] == "photo"
    assert confirmed_out["display_name"] == "Имя Фамилия"
