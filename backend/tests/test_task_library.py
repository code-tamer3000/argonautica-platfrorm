"""База заданий (админский хаб, GET /api/admin/tasks) и переиздание задачи на
другой поток (POST /api/admin/tasks/{id}/republish): клон без сдач, участник
прошлого потока, уже сдававший оригинал, получает клон заново с чистого листа.

Доступ проверяется на сервере на каждом запросе (CLAUDE.md п.1).
"""
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

from .conftest import MakeUser, auth_headers, login
from .test_admin_intakes import create_intake


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create_task(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/tasks", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_non_admin_cannot_use_library(
    client: AsyncClient, make_user: MakeUser
) -> None:
    member = await make_user()
    member_h = await _headers(client, member)
    assert (await client.get("/api/admin/tasks", headers=member_h)).status_code == 403
    assert (
        await client.post("/api/admin/tasks/1/republish", headers=member_h, json={"intake_id": 1})
    ).status_code == 403


async def test_library_excludes_cross_tasks_and_deleted(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)

    normal = await _create_task(client, admin_h, type="common", title="Обычная")
    deleted = await _create_task(client, admin_h, type="common", title="Удалённая")
    assert (
        await client.delete(f"/api/tasks/{deleted['id']}", headers=admin_h)
    ).status_code == 204

    pair = await _create_task(
        client,
        admin_h,
        type="pair",
        title="Пара",
        pairs=[{"user_ids": [a.id, b.id]}],
    )
    detail = await client.get(f"/api/tasks/{pair['id']}", headers=admin_h)
    pair_id = detail.json()["pairs"][0]["pair_id"]
    cross = await client.post(
        f"/api/tasks/{pair['id']}/pairs/{pair_id}/cross-task",
        headers=a_h,
        json={"title": "Перекрёстная"},
    )
    assert cross.status_code == 201

    library = await client.get("/api/admin/tasks", headers=admin_h)
    assert library.status_code == 200
    ids = [i["id"] for i in library.json()["items"]]
    assert normal["id"] in ids
    assert deleted["id"] not in ids
    assert cross.json()["id"] not in ids  # перекрёстная задача — не в базе


async def test_library_filters_by_intake_type_and_search(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    other_intake = await create_intake(client, admin_h)

    same = await _create_task(client, admin_h, type="common", title="Уникальный заголовок раз")
    other = await _create_task(
        client,
        admin_h,
        type="individual",
        title="Уникальный заголовок два",
        assignee_ids=[admin.id],
        intake_id=other_intake["id"],
    )

    by_intake = await client.get(
        f"/api/admin/tasks?intake_id={other_intake['id']}", headers=admin_h
    )
    ids = [i["id"] for i in by_intake.json()["items"]]
    assert other["id"] in ids
    assert same["id"] not in ids

    by_type = await client.get("/api/admin/tasks?type=individual", headers=admin_h)
    types = {i["type"] for i in by_type.json()["items"]}
    assert types <= {"individual"}

    by_q = await client.get("/api/admin/tasks?q=раз", headers=admin_h)
    q_ids = [i["id"] for i in by_q.json()["items"]]
    assert same["id"] in q_ids
    assert other["id"] not in q_ids


async def test_republish_rejects_pair_and_stream_and_cross_tasks(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    target_intake = await create_intake(client, admin_h)

    pair = await _create_task(
        client, admin_h, type="pair", title="Пара", pairs=[{"user_ids": [a.id, b.id]}]
    )
    resp = await client.post(
        f"/api/admin/tasks/{pair['id']}/republish",
        headers=admin_h,
        json={"intake_id": target_intake["id"]},
    )
    assert resp.status_code == 400

    stream = await _create_task(
        client,
        admin_h,
        type="stream",
        title="Поток",
        participant_ids=[a.id, b.id],
    )
    resp = await client.post(
        f"/api/admin/tasks/{stream['id']}/republish",
        headers=admin_h,
        json={"intake_id": target_intake["id"]},
    )
    assert resp.status_code == 400


async def test_republish_clones_without_assignments_and_lets_prior_submitter_redo(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    veteran = await make_user()  # сдавал оригинал в прошлом потоке
    admin_h = await _headers(client, admin)
    veteran_h = await _headers(client, veteran)
    target_intake = await create_intake(client, admin_h)

    original = await _create_task(
        client, admin_h, type="common", title="Заходило отлично", body="текст задания"
    )
    # Ветеран сдаёт и получает приёмку по оригиналу.
    submit = await client.post(
        f"/api/tasks/{original['id']}/submissions",
        headers=veteran_h,
        json={"body": "мой ответ"},
    )
    assert submit.status_code == 201
    track = await client.get(f"/api/tasks/{original['id']}/submissions", headers=admin_h)
    assignment_id = track.json()[0]["assignment_id"]
    review = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "accept"},
    )
    assert review.status_code == 200

    resp = await client.post(
        f"/api/admin/tasks/{original['id']}/republish",
        headers=admin_h,
        json={"intake_id": target_intake["id"]},
    )
    assert resp.status_code == 201, resp.text
    clone = resp.json()
    assert clone["id"] != original["id"]
    assert clone["type"] == "common"
    assert clone["title"] == original["title"]
    assert clone["body"] == original["body"]
    assert clone["intake_id"] == target_intake["id"]
    assert clone["source_task_id"] == original["id"]

    # Клон видит и старый, и новый участник — свежее, без унаследованных сдач.
    veteran_detail = await client.get(f"/api/tasks/{clone['id']}", headers=veteran_h)
    assert veteran_detail.status_code == 200
    assert veteran_detail.json()["my_status"] is None  # ещё не сдавал КЛОН

    veteran_can_submit = await client.post(
        f"/api/tasks/{clone['id']}/submissions",
        headers=veteran_h,
        json={"body": "сдаю заново"},
    )
    assert veteran_can_submit.status_code == 201

    # Оригинал остался нетронутым архивом со своей сдачей.
    original_detail = await client.get(f"/api/tasks/{original['id']}", headers=veteran_h)
    assert original_detail.json()["my_status"] == "accepted"


async def test_republish_conflicts_on_same_intake_twice(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    target_intake = await create_intake(client, admin_h)

    original = await _create_task(client, admin_h, type="common", title="Повтор")
    first = await client.post(
        f"/api/admin/tasks/{original['id']}/republish",
        headers=admin_h,
        json={"intake_id": target_intake["id"]},
    )
    assert first.status_code == 201

    second = await client.post(
        f"/api/admin/tasks/{original['id']}/republish",
        headers=admin_h,
        json={"intake_id": target_intake["id"]},
    )
    assert second.status_code == 409


async def test_republish_can_schedule_publication(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    target_intake = await create_intake(client, admin_h)

    original = await _create_task(client, admin_h, type="common", title="Со сроком")
    publish_at = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    resp = await client.post(
        f"/api/admin/tasks/{original['id']}/republish",
        headers=admin_h,
        json={"intake_id": target_intake["id"], "publish_at": publish_at},
    )
    assert resp.status_code == 201
    clone = resp.json()
    assert clone["publish_at"] is not None

    member = await make_user(intake_id=target_intake["id"])
    member_h = await _headers(client, member)
    detail = await client.get(f"/api/tasks/{clone['id']}", headers=member_h)
    assert detail.status_code == 404  # запланировано на будущее — пока скрыта
