"""Архив прошлых потоков (мульти-поток): участник/админ, переведённый в новый
поток, получает вручную выданный (`archive_intake_ids`, PATCH /api/admin/users)
доступ на ЧТЕНИЕ дневников и КБ прошлого потока — см. app/services/visibility.py
`user_intake_scope`/`diary_visible`/`kb_intake_visible`.

Расширяет ровно дневники + КБ. Каналы/новости/common-задачи/календарь/ростер
«Аргонавты» архив не трогает — те продолжают жить на одном `users.intake_id`.
"""
import itertools
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.room import Room
from app.models.user import User

from .conftest import MakeUser, auth_headers, login

# Свой диапазон смещений (260..~300) — не пересекается с test_rank_visibility.py
# (с 500) и точечными офсетами в других файлах (test_argonauts.py держит 200-214).
# Дальше intakes.ends_on = starts_on + 400 (дефолт get_or_create_intake) уходило бы
# в прошлое — окно набора закрывалось бы и ломало отправку сообщений в тестах.
_intake_offset = itertools.count(260)


def _next_starts_on() -> date:
    return date.today() - timedelta(days=next(_intake_offset))


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _make_personal_room(session: AsyncSession, owner_id: int) -> Room:
    room = Room(type="channel", name="Дневник", is_personal=True, created_by=owner_id)
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


async def _grant_archive(
    client: AsyncClient, admin_h: dict[str, str], user_id: int, intake_ids: list[int]
) -> None:
    resp = await client.patch(
        f"/api/admin/users/{user_id}",
        headers=admin_h,
        json={"archive_intake_ids": intake_ids},
    )
    assert resp.status_code == 200, resp.text


async def test_archive_restores_diary_access_after_move(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """A переведён из intake 1 в intake 2. Без архива дневник B (intake 1) ему
    недоступен; выдача архива на intake 1 восстанавливает и список, и прямой GET."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    old_intake_id = (await make_user(intake_starts_on=_next_starts_on())).intake_id
    a = await make_user(intake_id=old_intake_id)
    b = await make_user(intake_id=old_intake_id)
    b_room = await _make_personal_room(session, b.id)

    new_intake_id = (await make_user(intake_starts_on=_next_starts_on())).intake_id

    a_h = await _headers(client, a)
    before = await client.get(f"/api/rooms/{b_room.id}", headers=a_h)
    assert before.status_code == 200  # ещё тот же поток

    moved = await client.patch(
        f"/api/admin/users/{a.id}", headers=admin_h, json={"intake_id": new_intake_id}
    )
    assert moved.status_code == 200, moved.text

    a_h = await _headers(client, a)
    gone = await client.get(f"/api/rooms/{b_room.id}", headers=a_h)
    assert gone.status_code == 403
    listed_gone = await client.get("/api/rooms", headers=a_h)
    assert b_room.id not in {r["id"] for r in listed_gone.json()}

    await _grant_archive(client, admin_h, a.id, [old_intake_id])
    a_h = await _headers(client, a)

    restored = await client.get(f"/api/rooms/{b_room.id}", headers=a_h)
    assert restored.status_code == 200
    listed_back = await client.get("/api/rooms", headers=a_h)
    assert b_room.id in {r["id"] for r in listed_back.json()}


async def test_archive_symmetry_old_cohort_sees_moved_user(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Симметрия: B, оставшийся в intake 1, продолжает видеть дневник A и после
    того, как A перевели в intake 2 — если у A есть архив на intake 1."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    old_intake = await make_user(intake_starts_on=_next_starts_on())
    a = await make_user(intake_id=old_intake.intake_id)
    a_room = await _make_personal_room(session, a.id)
    b = await make_user(intake_id=old_intake.intake_id)

    new_intake = await make_user(intake_starts_on=_next_starts_on())
    await client.patch(
        f"/api/admin/users/{a.id}", headers=admin_h, json={"intake_id": new_intake.intake_id}
    )

    b_h = await _headers(client, b)
    assert (await client.get(f"/api/rooms/{a_room.id}", headers=b_h)).status_code == 403

    await _grant_archive(client, admin_h, a.id, [old_intake.intake_id])

    ok = await client.get(f"/api/rooms/{a_room.id}", headers=b_h)
    assert ok.status_code == 200
    listed = await client.get("/api/rooms", headers=b_h)
    assert a_room.id in {r["id"] for r in listed.json()}


async def test_admin_former_participant_diary_visible_via_archive(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Админ, который БЫЛ участником потока (архивная строка на этот поток), —
    его дневник виден участникам того потока; без строки — по-прежнему скрыт
    (Динамика не для админов, ARG-112 не меняем)."""
    root_admin = await make_user(role="admin")
    root_admin_h = await _headers(client, root_admin)

    intake = await make_user(intake_starts_on=_next_starts_on())
    peer = await make_user(intake_id=intake.intake_id)

    # Бывший участник, ставший админом — сейчас в ДРУГОМ (активном) потоке.
    other_intake = await make_user(intake_starts_on=_next_starts_on())
    former_participant_admin = await make_user(
        role="admin", intake_id=other_intake.intake_id
    )
    admin_room = await _make_personal_room(session, former_participant_admin.id)

    peer_h = await _headers(client, peer)
    hidden = await client.get(f"/api/rooms/{admin_room.id}", headers=peer_h)
    assert hidden.status_code == 403

    await _grant_archive(
        client, root_admin_h, former_participant_admin.id, [intake.intake_id]
    )

    shown = await client.get(f"/api/rooms/{admin_room.id}", headers=peer_h)
    assert shown.status_code == 200
    listed = await client.get("/api/rooms", headers=peer_h)
    assert admin_room.id in {r["id"] for r in listed.json()}


async def test_archive_grants_kb_read_and_media(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    old_intake = await make_user(intake_starts_on=_next_starts_on())
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/09/archive-kb.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=admin.id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)

    created = await client.post(
        "/api/kb/items",
        headers=admin_h,
        json={
            "title": "Материал старого потока",
            "published": True,
            "intake_id": old_intake.intake_id,
            "media_asset_ids": [asset.id],
        },
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    moved = await make_user(intake_id=old_intake.intake_id)
    new_intake = await make_user(intake_starts_on=_next_starts_on())
    await client.patch(
        f"/api/admin/users/{moved.id}",
        headers=admin_h,
        json={"intake_id": new_intake.intake_id},
    )

    moved_h = await _headers(client, moved)
    assert (await client.get(f"/api/kb/items/{item_id}", headers=moved_h)).status_code == 404
    assert (await client.get(f"/api/media/{asset.id}", headers=moved_h)).status_code == 403

    await _grant_archive(client, admin_h, moved.id, [old_intake.intake_id])

    ok_item = await client.get(f"/api/kb/items/{item_id}", headers=moved_h)
    assert ok_item.status_code == 200
    ok_media = await client.get(f"/api/media/{asset.id}", headers=moved_h)
    assert ok_media.status_code == 200


async def test_archive_diary_access_is_read_only(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Комментировать (тред) чужой архивный дневник нельзя — только через
    активный поток. Владелец своей записи может писать всегда (не проверяем —
    вне сферы архива)."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    old_intake = await make_user(intake_starts_on=_next_starts_on())
    owner = await make_user(intake_id=old_intake.intake_id)
    owner_room = await _make_personal_room(session, owner.id)
    top_msg = await client.post(
        f"/api/rooms/{owner_room.id}/messages",
        headers=await _headers(client, owner),
        json={"content": "Запись дневника"},
    )
    assert top_msg.status_code == 201, top_msg.text
    root_id = top_msg.json()["id"]

    moved = await make_user(intake_id=old_intake.intake_id)
    new_intake = await make_user(intake_starts_on=_next_starts_on())
    await client.patch(
        f"/api/admin/users/{moved.id}",
        headers=admin_h,
        json={"intake_id": new_intake.intake_id},
    )
    await _grant_archive(client, admin_h, moved.id, [old_intake.intake_id])

    moved_h = await _headers(client, moved)
    read = await client.get(f"/api/rooms/{owner_room.id}", headers=moved_h)
    assert read.status_code == 200

    comment = await client.post(
        f"/api/rooms/{owner_room.id}/messages",
        headers=moved_h,
        json={"content": "Комментарий из архива", "reply_to_message_id": root_id},
    )
    assert comment.status_code == 403


async def test_archive_does_not_leak_channels_tasks_calendar_roster(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """Архив расширяет ТОЛЬКО дневники+КБ — каналы, common-задачи, календарь и
    ростер «Аргонавты» прошлого потока остаются недоступны."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    old_intake = await make_user(intake_starts_on=_next_starts_on())
    peer = await make_user(intake_id=old_intake.intake_id, display_name="Пир старого потока")

    channel = await client.post(
        "/api/rooms",
        headers=admin_h,
        json={"type": "channel", "name": "Канал потока", "intake_id": old_intake.intake_id},
    )
    assert channel.status_code == 201
    channel_id = channel.json()["id"]

    task = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={
            "type": "common",
            "title": "Общая задача потока",
            "intake_id": old_intake.intake_id,
        },
    )
    assert task.status_code == 201
    task_id = task.json()["id"]

    event = await client.post(
        "/api/calendar/events",
        headers=admin_h,
        json={
            "title": "Событие потока",
            "starts_at": f"{date.today().isoformat()}T10:00:00Z",
            "intake_id": old_intake.intake_id,
        },
    )
    assert event.status_code == 201

    moved = await make_user(intake_id=old_intake.intake_id)
    new_intake = await make_user(intake_starts_on=_next_starts_on())
    await client.patch(
        f"/api/admin/users/{moved.id}",
        headers=admin_h,
        json={"intake_id": new_intake.intake_id},
    )
    await _grant_archive(client, admin_h, moved.id, [old_intake.intake_id])

    moved_h = await _headers(client, moved)
    assert (await client.get(f"/api/rooms/{channel_id}", headers=moved_h)).status_code == 403
    assert (await client.get(f"/api/tasks/{task_id}", headers=moved_h)).status_code == 403
    events = await client.get("/api/calendar/events", headers=moved_h)
    assert events.status_code == 200
    assert all(e["title"] != "Событие потока" for e in events.json())

    roster = await client.get("/api/argonauts", headers=moved_h)
    assert roster.status_code == 200
    assert peer.id not in {u["id"] for u in roster.json()}


async def test_patch_archive_intake_ids_rejects_unknown_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    target = await make_user()

    bad = await client.patch(
        f"/api/admin/users/{target.id}",
        headers=admin_h,
        json={"archive_intake_ids": [999_999_999]},
    )
    assert bad.status_code == 400


async def test_patch_archive_intake_ids_ignores_active_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Активный поток, переданный в архивном наборе, не сохраняется отдельной
    строкой — не 400, идемпотентно для клиента."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    target = await make_user()

    ok = await client.patch(
        f"/api/admin/users/{target.id}",
        headers=admin_h,
        json={"archive_intake_ids": [target.intake_id]},
    )
    assert ok.status_code == 200, ok.text

    listed = await client.get("/api/admin/users", headers=admin_h)
    row = next(u for u in listed.json() if u["id"] == target.id)
    assert row["archive_intake_ids"] == []
