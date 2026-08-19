"""Изоляция контента по потоку и тарифу (ARG-96): двойной фильтр видимости на
каналах, common-задачах и материалах КБ + IDOR-регресс, окно набора в Динамике.

Механизм — не продуктовое правило «что входит в тариф» (ARG-26): здесь только
проверка, что NULL/пусто = видно всем, а непустой intake_id/plan_ids сужают
видимость до своего потока/перечисленных тарифов, отдельно и совместно.
"""
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.room import Room
from app.models.user import User

from .conftest import MakeUser, auth_headers, login
from .test_admin_intakes import free_starts_on


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _make_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/08/x.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def _make_personal_room(session: AsyncSession, owner_id: int) -> Room:
    """Личный дневник, как его заводит admin.create_user — фикстура make_user его
    не создаёт (это отдельный побочный эффект админской ручки)."""
    room = Room(type="channel", name="Дневник", is_personal=True, created_by=owner_id)
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


async def _create_plan(client: AsyncClient, headers: dict[str, str], name: str) -> int:
    resp = await client.post(
        "/api/admin/plans", headers=headers, json={"name": name, "price": 1000}
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


# --- каналы -------------------------------------------------------------------


async def test_channel_isolated_by_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    mine = await make_user(intake_starts_on=date.today() - timedelta(days=100))
    other = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    created = await client.post(
        "/api/rooms",
        headers=admin_h,
        json={"type": "channel", "name": "Поток А", "intake_id": mine.intake_id},
    )
    assert created.status_code == 201, created.text
    channel_id = created.json()["id"]

    # Свой поток видит канал и в списке, и по id.
    mine_listed = await client.get("/api/rooms", headers=await _headers(client, mine))
    assert channel_id in {r["id"] for r in mine_listed.json()}
    mine_one = await client.get(f"/api/rooms/{channel_id}", headers=await _headers(client, mine))
    assert mine_one.status_code == 200

    # Чужой поток не видит канал ни в списке, ни по id (403 — анти-IDOR).
    other_h = await _headers(client, other)
    other_listed = await client.get("/api/rooms", headers=other_h)
    assert channel_id not in {r["id"] for r in other_listed.json()}
    other_one = await client.get(f"/api/rooms/{channel_id}", headers=other_h)
    assert other_one.status_code == 403

    # Admin видит канал вне зависимости от потока.
    admin_one = await client.get(f"/api/rooms/{channel_id}", headers=admin_h)
    assert admin_one.status_code == 200


async def test_channel_isolated_by_plan(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    plan_a = await _create_plan(client, admin_h, "Тариф А")
    with_plan = await make_user(plan_id=plan_a)
    without_plan = await make_user(plan_id=None)

    created = await client.post(
        "/api/rooms",
        headers=admin_h,
        json={"type": "channel", "name": "Эксклюзив", "plan_ids": [plan_a]},
    )
    assert created.status_code == 201
    channel_id = created.json()["id"]

    with_h = await _headers(client, with_plan)
    without_h = await _headers(client, without_plan)

    assert (await client.get(f"/api/rooms/{channel_id}", headers=with_h)).status_code == 200
    assert (await client.get(f"/api/rooms/{channel_id}", headers=without_h)).status_code == 403
    listed = await client.get("/api/rooms", headers=without_h)
    assert channel_id not in {r["id"] for r in listed.json()}


async def test_channel_media_access_gated_by_isolation(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    other = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    created = await client.post(
        "/api/rooms",
        headers=admin_h,
        json={"type": "channel", "name": "Приватный поток", "intake_id": admin.intake_id},
    )
    channel_id = created.json()["id"]
    asset = await _make_asset(session, admin.id)
    sent = await client.post(
        f"/api/rooms/{channel_id}/messages",
        headers=admin_h,
        json={"content": "фото", "attachment_ids": [asset.id]},
    )
    assert sent.status_code == 201, sent.text

    # Чужой поток не проходит по каналу → presigned-ссылка на медиа не выдаётся.
    other_h = await _headers(client, other)
    denied = await client.get(f"/api/media/{asset.id}", headers=other_h)
    assert denied.status_code == 403


# --- common-задачи --------------------------------------------------------------


async def test_common_task_isolated_by_intake(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    mine = await make_user(intake_starts_on=date.today() - timedelta(days=100))
    other = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    created = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Своему потоку", "intake_id": mine.intake_id},
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]

    mine_h = await _headers(client, mine)
    other_h = await _headers(client, other)

    mine_listed = await client.get("/api/tasks", headers=mine_h)
    assert task_id in {t["id"] for t in mine_listed.json()["items"]}
    assert (await client.get(f"/api/tasks/{task_id}", headers=mine_h)).status_code == 200

    other_listed = await client.get("/api/tasks", headers=other_h)
    assert task_id not in {t["id"] for t in other_listed.json()["items"]}
    assert (await client.get(f"/api/tasks/{task_id}", headers=other_h)).status_code == 403


async def test_common_task_isolated_by_plan(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    plan_a = await _create_plan(client, admin_h, "Тариф Б")
    with_plan = await make_user(plan_id=plan_a)
    without_plan = await make_user(plan_id=None)

    created = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Только тариф Б", "plan_ids": [plan_a]},
    )
    task_id = created.json()["id"]

    with_h = await _headers(client, with_plan)
    without_h = await _headers(client, without_plan)
    assert (await client.get(f"/api/tasks/{task_id}", headers=with_h)).status_code == 200
    assert (await client.get(f"/api/tasks/{task_id}", headers=without_h)).status_code == 403


async def test_individual_task_ignores_intake_isolation(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Явное назначение сильнее потока: individual-задача видна адресату другого
    потока — фильтр intake_id/plan_ids действует только на common (ARG-96)."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    assignee = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    created = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={
            "type": "individual",
            "title": "Персонально",
            "assignee_ids": [assignee.id],
            "intake_id": admin.intake_id,  # намеренно чужой поток адресата
        },
    )
    assert created.status_code == 201
    task_id = created.json()["id"]

    assignee_h = await _headers(client, assignee)
    assert (await client.get(f"/api/tasks/{task_id}", headers=assignee_h)).status_code == 200


async def test_task_media_access_gated_by_isolation(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    other = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    asset = await _make_asset(session, admin.id)
    created = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={
            "type": "common",
            "title": "С медиа",
            "intake_id": admin.intake_id,
            "media_asset_ids": [asset.id],
        },
    )
    assert created.status_code == 201, created.text

    other_h = await _headers(client, other)
    denied = await client.get(f"/api/media/{asset.id}", headers=other_h)
    assert denied.status_code == 403


# --- материалы базы знаний -------------------------------------------------------


async def test_kb_item_isolated_by_intake(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    mine = await make_user(intake_starts_on=date.today() - timedelta(days=100))
    other = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    created = await client.post(
        "/api/kb/items",
        headers=admin_h,
        json={"title": "Своему потоку", "published": True, "intake_id": mine.intake_id},
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    mine_h = await _headers(client, mine)
    other_h = await _headers(client, other)

    mine_listed = await client.get("/api/kb/items", headers=mine_h)
    assert item_id in {i["id"] for i in mine_listed.json()}
    assert (await client.get(f"/api/kb/items/{item_id}", headers=mine_h)).status_code == 200

    # Чужой поток — 404 (не 403): черновик/чужой материал не раскрываем.
    other_listed = await client.get("/api/kb/items", headers=other_h)
    assert item_id not in {i["id"] for i in other_listed.json()}
    assert (await client.get(f"/api/kb/items/{item_id}", headers=other_h)).status_code == 404


async def test_kb_item_isolated_by_plan_and_media(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    plan_a = await _create_plan(client, admin_h, "Тариф В")
    with_plan = await make_user(plan_id=plan_a)
    without_plan = await make_user(plan_id=None)

    asset = await _make_asset(session, admin.id)
    created = await client.post(
        "/api/kb/items",
        headers=admin_h,
        json={
            "title": "Только тариф В",
            "published": True,
            "plan_ids": [plan_a],
            "media_asset_ids": [asset.id],
        },
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    with_h = await _headers(client, with_plan)
    without_h = await _headers(client, without_plan)
    assert (await client.get(f"/api/kb/items/{item_id}", headers=with_h)).status_code == 200
    assert (await client.get(f"/api/kb/items/{item_id}", headers=without_h)).status_code == 404
    assert (await client.get(f"/api/media/{asset.id}", headers=with_h)).status_code == 200
    assert (await client.get(f"/api/media/{asset.id}", headers=without_h)).status_code == 403


# --- окно набора (Динамика) ------------------------------------------------------


async def test_dynamics_window_closed_freezes_and_blocks_writes(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    today = date.today()
    user = await make_user(
        intake_starts_on=today - timedelta(days=60),
        intake_ends_on=today - timedelta(days=30),
    )
    room = await _make_personal_room(session, user.id)
    headers = await _headers(client, user)

    stats = await client.get("/api/dynamics/my-stats", headers=headers)
    assert stats.status_code == 200
    assert stats.json()["window_closed"] is True

    pardon = await client.post(
        "/api/dynamics/pardon",
        headers=headers,
        json={"date": (today - timedelta(days=1)).isoformat()},
    )
    assert pardon.status_code == 403

    personal = await client.get("/api/rooms/personal", headers=headers)
    assert personal.status_code == 200
    assert personal.json()["id"] == room.id
    sent = await client.post(
        f"/api/rooms/{room.id}/messages", headers=headers, json={"content": "запись"}
    )
    assert sent.status_code == 403


async def test_dynamics_window_open_allows_writes(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    today = date.today()
    user = await make_user(
        intake_starts_on=today - timedelta(days=10),
        intake_ends_on=today + timedelta(days=18),
    )
    room = await _make_personal_room(session, user.id)
    headers = await _headers(client, user)

    stats = await client.get("/api/dynamics/my-stats", headers=headers)
    assert stats.status_code == 200
    assert stats.json()["window_closed"] is False

    sent = await client.post(
        f"/api/rooms/{room.id}/messages", headers=headers, json={"content": "запись"}
    )
    assert sent.status_code == 201


# --- админка наборов ---------------------------------------------------------------


async def test_historical_intake_has_corrected_window(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Миграция 8f3c1a9d5e21 поправила исторический набор (сеялся с ошибочной
    starts_on=2026-06-02): теперь 02.07.2026 – 29.07.2026."""
    admin = await make_user(role="admin")
    headers = await _headers(client, admin)

    listed = await client.get("/api/admin/intakes", headers=headers)
    assert listed.status_code == 200
    # Тестовая БД персистентна и копит наборы между прогонами (не обязательно
    # самый ранний по starts_on) — ищем именно исправленную историческую строку.
    historical = next(
        (i for i in listed.json() if i["starts_on"] == "2026-07-02"), None
    )
    assert historical is not None, "Исторический набор 2026-07-02 не найден"
    assert historical["ends_on"] == "2026-07-29"


async def test_create_intake_requires_ends_on_after_starts_on(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    headers = await _headers(client, admin)
    starts_on = await free_starts_on(client, headers)

    bad = await client.post(
        "/api/admin/intakes",
        headers=headers,
        json={"starts_on": starts_on.isoformat(), "ends_on": starts_on.isoformat()},
    )
    assert bad.status_code == 422

    ok = await client.post(
        "/api/admin/intakes",
        headers=headers,
        json={
            "starts_on": starts_on.isoformat(),
            "ends_on": (starts_on + timedelta(days=28)).isoformat(),
        },
    )
    assert ok.status_code == 201


# --- личные дневники в разделе «Все дневники» ------------------------------------
#
# Дневник виден не только владельцу («Все дневники» — реальная фича, не утечка):
# чужой дневник открыт, только если у смотрящего совпали И поток, И тариф с
# владельцем (см. same_cohort в app/services/visibility.py). Сама комната своего
# intake_id не несёт — сравниваются владелец и смотрящий напрямую.


async def test_personal_diary_visible_within_same_cohort(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    plan_admin = await make_user(role="admin")
    plan_a = await _create_plan(client, await _headers(client, plan_admin), "Тариф Г")

    owner = await make_user(
        intake_starts_on=date.today() - timedelta(days=50), plan_id=plan_a
    )
    # Тот же набор (intake_id) и тариф, что и owner — совпадает по same_cohort.
    peer = await make_user(intake_id=owner.intake_id, plan_id=plan_a)
    room = await _make_personal_room(session, owner.id)

    peer_h = await _headers(client, peer)
    one = await client.get(f"/api/rooms/{room.id}", headers=peer_h)
    assert one.status_code == 200

    listed = await client.get("/api/rooms", headers=peer_h)
    assert room.id in {r["id"] for r in listed.json()}


async def test_personal_diary_hidden_across_intake(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    owner = await make_user(intake_starts_on=date.today() - timedelta(days=50))
    other_intake = await make_user(intake_starts_on=date.today() - timedelta(days=1))
    room = await _make_personal_room(session, owner.id)

    other_h = await _headers(client, other_intake)
    one = await client.get(f"/api/rooms/{room.id}", headers=other_h)
    assert one.status_code == 403

    listed = await client.get("/api/rooms", headers=other_h)
    assert room.id not in {r["id"] for r in listed.json()}


async def test_personal_diary_hidden_across_plan(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    plan_a = await _create_plan(client, admin_h, "Тариф Д")

    owner = await make_user(plan_id=plan_a)
    other_plan = await make_user(intake_id=owner.intake_id, plan_id=None)
    room = await _make_personal_room(session, owner.id)

    other_h = await _headers(client, other_plan)
    one = await client.get(f"/api/rooms/{room.id}", headers=other_h)
    assert one.status_code == 403

    listed = await client.get("/api/rooms", headers=other_h)
    assert room.id not in {r["id"] for r in listed.json()}


async def test_personal_diary_always_visible_to_owner_and_admin(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    owner = await make_user(intake_starts_on=date.today() - timedelta(days=1))
    room = await _make_personal_room(session, owner.id)

    owner_h = await _headers(client, owner)
    assert (await client.get(f"/api/rooms/{room.id}", headers=owner_h)).status_code == 200

    admin_h = await _headers(client, admin)
    assert (await client.get(f"/api/rooms/{room.id}", headers=admin_h)).status_code == 200
