"""Междумирье (docs/LIMBO.md): 5-дневный грейс-период после понижения с
платного тарифа на самый дешёвый — старые незавершённые тарифные задачи не
закрываются сразу, добавляется допзадание-дневник, тариф возвращается при
выполнении требований или срок просто истекает (нет планировщика — всё лениво,
проверяется на следующем запросе, см. services/limbo.py).
"""
import itertools
from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.limbo import MAKEUP_TASK_TITLE

from .conftest import MakeUser, auth_headers, login

_intake_offset = itertools.count(900)


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create_plan(
    client: AsyncClient, headers: dict[str, str], name: str, price: int
) -> int:
    resp = await client.post(
        "/api/admin/plans", headers=headers, json={"name": name, "price": price}
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


async def _create_common_task(
    client: AsyncClient, headers: dict[str, str], title: str, **extra: object
) -> int:
    resp = await client.post(
        "/api/tasks", headers=headers, json={"type": "common", "title": title, **extra}
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


async def _submit_and_accept(
    client: AsyncClient, admin_h: dict[str, str], user_h: dict[str, str], task_id: int
) -> None:
    resp = await client.post(
        f"/api/tasks/{task_id}/submissions", headers=user_h, json={"body": "x"}
    )
    assert resp.status_code == 201, resp.text
    tracks = (await client.get(f"/api/tasks/{task_id}/submissions", headers=admin_h)).json()
    assignment_id = tracks[0]["assignment_id"]
    review = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "accept"},
    )
    assert review.status_code == 200, review.text


async def _setup(
    client: AsyncClient, make_user: MakeUser
) -> tuple[User, dict[str, str], User, int, int, int]:
    starts_on = date.today() - timedelta(days=next(_intake_offset))
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    plan_paid = await _create_plan(client, admin_h, "Игрок", 1000)
    plan_cheap = await _create_plan(client, admin_h, "Наблюдатель", 500)
    plan_other_paid = await _create_plan(client, admin_h, "Спецотряд", 2000)
    user = await make_user(intake_id=admin.intake_id, plan_id=plan_paid)
    return admin, admin_h, user, plan_paid, plan_cheap, plan_other_paid


async def test_limbo_starts_on_downgrade_from_paid_to_cheap(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin, admin_h, user, _plan_paid, plan_cheap, _ = await _setup(client, make_user)

    patched = await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )
    assert patched.status_code == 200

    user_h = await _headers(client, user)
    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is not None

    tasks = (await client.get("/api/tasks", headers=user_h)).json()["items"]
    makeup = next((t for t in tasks if t["title"] == MAKEUP_TASK_TITLE), None)
    assert makeup is not None
    assert makeup["type"] == "individual"


async def test_limbo_not_started_without_previous_plan(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Понижение на дешёвый тариф с ПУСТОГО (не с платного) — не Междумирье."""
    admin, admin_h, user, _plan_paid, plan_cheap, _ = await _setup(client, make_user)
    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": None}
    )

    patched = await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )
    assert patched.status_code == 200

    user_h = await _headers(client, user)
    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is None


async def test_limbo_not_started_for_lateral_paid_change(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Смена между двумя платными тарифами — не Междумирье, только посадка на
    самый дешёвый именно с платного."""
    admin, admin_h, user, _plan_paid, _plan_cheap, plan_other_paid = await _setup(
        client, make_user
    )
    patched = await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_other_paid}
    )
    assert patched.status_code == 200

    user_h = await _headers(client, user)
    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is None


async def test_limbo_preserves_incomplete_task_visibility(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Незавершённая common-задача прошлого (платного) тарифа не закрывается
    сразу — доступна во время Междумирья благодаря _effective_plan_id."""
    admin, admin_h, user, plan_paid, plan_cheap, _ = await _setup(client, make_user)
    old_task = await _create_common_task(
        client, admin_h, "Старая задача Игрока", plan_ids=[plan_paid]
    )

    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )

    user_h = await _headers(client, user)
    detail = await client.get(f"/api/tasks/{old_task}", headers=user_h)
    assert detail.status_code == 200
    listed = await client.get("/api/tasks", headers=user_h)
    assert old_task in {t["id"] for t in listed.json()["items"]}


async def test_limbo_resolves_when_requirements_met(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Сдал и старую задачу, и допзадание — тариф вернулся сразу, не дожидаясь
    самого дедлайна."""
    admin, admin_h, user, plan_paid, plan_cheap, _ = await _setup(client, make_user)
    old_task = await _create_common_task(
        client, admin_h, "Старая задача Игрока", plan_ids=[plan_paid]
    )

    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )
    user_h = await _headers(client, user)

    tasks = (await client.get("/api/tasks", headers=user_h)).json()["items"]
    makeup = next(t for t in tasks if t["title"] == MAKEUP_TASK_TITLE)

    await _submit_and_accept(client, admin_h, user_h, old_task)
    await _submit_and_accept(client, admin_h, user_h, makeup["id"])

    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is None

    listed = await client.get("/api/admin/users", headers=admin_h)
    row = next(u for u in listed.json() if u["id"] == user.id)
    assert row["plan_id"] == plan_paid


async def test_limbo_not_resolved_while_makeup_task_unfinished(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Старая задача сдана, но допзадание — нет: тариф пока НЕ возвращается."""
    admin, admin_h, user, plan_paid, plan_cheap, _ = await _setup(client, make_user)
    old_task = await _create_common_task(
        client, admin_h, "Старая задача Игрока", plan_ids=[plan_paid]
    )

    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )
    user_h = await _headers(client, user)
    await _submit_and_accept(client, admin_h, user_h, old_task)

    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is not None

    listed = await client.get("/api/admin/users", headers=admin_h)
    row = next(u for u in listed.json() if u["id"] == user.id)
    assert row["plan_id"] == plan_cheap


async def test_limbo_finalizes_as_plain_cheap_tariff_after_deadline(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Ничего не выполнил, срок вышел — остаётся на дешёвом тарифе без
    спецдоступа к прошлым задачам. Дедлайн форсируем напрямую в БД — в проекте
    нет планировщика, реальные 5 дней ждать негде."""
    admin, admin_h, user, plan_paid, plan_cheap, _ = await _setup(client, make_user)
    old_task = await _create_common_task(
        client, admin_h, "Старая задача Игрока", plan_ids=[plan_paid]
    )

    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )

    db_user = await session.get(User, user.id)
    assert db_user is not None
    db_user.limbo_deadline_at = datetime.now(UTC) - timedelta(days=1)
    await session.commit()

    user_h = await _headers(client, user)
    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is None

    listed = await client.get("/api/admin/users", headers=admin_h)
    row = next(u for u in listed.json() if u["id"] == user.id)
    assert row["plan_id"] == plan_cheap  # НЕ восстановлен — просто снята срочность

    assert (await client.get(f"/api/tasks/{old_task}", headers=user_h)).status_code == 403


async def test_limbo_abandoned_on_manual_override(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Админ вручную сменил тариф ещё раз посреди Междумирья — считаем это его
    решением, срок не ждём, состояние снимается сразу."""
    admin, admin_h, user, _plan_paid, plan_cheap, plan_other_paid = await _setup(
        client, make_user
    )
    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )
    user_h = await _headers(client, user)
    assert (
        await client.get("/api/auth/me", headers=user_h)
    ).json()["limbo_deadline_at"] is not None

    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_other_paid}
    )

    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is None


async def test_limbo_popup_dismiss_resets_on_next_entry(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """«Не показывать снова» (settings.limbo_popup_dismissed) не должно
    переживать следующий заход в Междумирье — иначе поп-ап молчал бы навсегда
    после первого же понижения, что бы ни случилось дальше."""
    admin, admin_h, user, _plan_paid, plan_cheap, plan_other_paid = await _setup(
        client, make_user
    )
    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )
    user_h = await _headers(client, user)

    dismiss = await client.patch(
        "/api/auth/me",
        headers=user_h,
        json={"settings": {"limbo_popup_dismissed": True}},
    )
    assert dismiss.status_code == 200
    assert dismiss.json()["settings"]["limbo_popup_dismissed"] is True

    # Отменить вручную (абандон) и понизить заново — новый заход должен снова
    # показывать поп-ап.
    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_other_paid}
    )
    await client.patch(
        f"/api/admin/users/{user.id}", headers=admin_h, json={"plan_id": plan_cheap}
    )

    me = (await client.get("/api/auth/me", headers=user_h)).json()
    assert me["limbo_deadline_at"] is not None
    assert me["settings"].get("limbo_popup_dismissed") is False
