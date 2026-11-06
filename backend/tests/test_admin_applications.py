"""Веб-воронка приёма — GET /api/admin/applications (ARG-107, read-only CRM)."""
import random
from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake import Intake

from app.models.intake_application import IntakeApplication
from app.models.plan import Plan
from app.schemas.intake_application import FUNNEL_STATUSES

from .conftest import MakeUser, auth_headers, get_or_create_intake, login


async def admin_headers(client: AsyncClient, make_user: MakeUser) -> dict[str, str]:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    return auth_headers(tokens["access_token"])


def _next_tg_id() -> int:
    # tg_id UNIQUE, тестовая БД переживает прогоны — широкий диапазон, тот же приём,
    # что в test_intake_bot.py::make_application (узкий диапазон реально коллидировал).
    return random.randint(10**9, 10**12)


async def test_non_admin_forbidden(client: AsyncClient, make_user: MakeUser) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    headers = auth_headers(tokens["access_token"])

    resp = await client.get("/api/admin/applications", headers=headers)
    assert resp.status_code == 403


async def test_unauthenticated_rejected(client: AsyncClient) -> None:
    resp = await client.get("/api/admin/applications")
    assert resp.status_code == 401


async def test_empty_by_status_has_all_stage_keys(
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


async def test_filter_by_intake_scopes_items_and_counters(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-189: `?intake_id=` сужает и список, и `by_status`/`total`/`by_kind`."""
    headers = await admin_headers(client, make_user)
    current_max = await session.scalar(select(func.max(Intake.starts_on)))
    base = (current_max or date.today()) + timedelta(days=1)
    old = await get_or_create_intake(session, base)
    new = await get_or_create_intake(session, base + timedelta(days=100))

    def app(intake: Intake, status: str, kind: str | None) -> IntakeApplication:
        return IntakeApplication(
            tg_id=_next_tg_id(), status=status, intake_id=intake.id, applicant_kind=kind
        )

    old_app = app(old, "expired", "new")
    new_apps = [
        app(new, "awaiting_about", "new"),
        app(new, "awaiting_about", "new"),
        app(new, "submitted", "retry"),
        app(new, "choosing_plan", "returning"),
        app(new, "confirmed", None),  # заявка до появления типа — в счётчик типов не входит
    ]
    session.add_all([old_app, *new_apps])
    await session.commit()

    new_body = (
        await client.get(f"/api/admin/applications?intake_id={new.id}", headers=headers)
    ).json()
    assert new_body["total"] == 5
    assert new_body["by_status"]["awaiting_about"] == 2
    assert new_body["by_status"]["expired"] == 0
    assert new_body["by_kind"] == {"new": 2, "retry": 1, "returning": 1}
    assert {i["id"] for i in new_body["items"]} == {a.id for a in new_apps}
    assert all(i["intake_id"] == new.id for i in new_body["items"])
    assert {i["applicant_kind"] for i in new_body["items"]} == {"new", "retry", "returning", None}

    old_body = (
        await client.get(f"/api/admin/applications?intake_id={old.id}", headers=headers)
    ).json()
    assert old_body["total"] == 1
    assert old_body["by_status"]["expired"] == 1
    assert old_body["by_kind"] == {"new": 1, "retry": 0, "returning": 0}
    assert [i["id"] for i in old_body["items"]] == [old_app.id]

    all_body = (await client.get("/api/admin/applications", headers=headers)).json()
    all_ids = {i["id"] for i in all_body["items"]}
    assert old_app.id in all_ids and {a.id for a in new_apps} <= all_ids
