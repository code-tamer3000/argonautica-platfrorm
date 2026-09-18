"""Черновик задачи (`tasks.is_draft`, аналог kb_items.published): пока флаг стоит,
задача существует только для админа — в списке, детали, сдаче, календаре и медиа
она не видна никому другому, независимо от publish_at. Снятие флага публикует её
той же ленивой проверкой, без планировщика (services/tasks.py::published_where).

Доступ проверяется на сервере на каждом запросе (CLAUDE.md п.1).
"""
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create_task(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/tasks", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _future_iso(hours: int = 2) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).isoformat()


async def test_draft_task_hidden_from_participant_everywhere(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(
        client,
        admin_h,
        type="common",
        title="Ещё не готово",
        deadline_at=_future_iso(hours=48),
        is_draft=True,
    )
    assert task["is_draft"] is True

    listed = await client.get("/api/tasks", headers=member_h)
    assert listed.status_code == 200
    assert task["id"] not in [t["id"] for t in listed.json()["items"]]

    # Прямой запрос — 404, та же семантика «ещё не существует», что у отложенной.
    assert (await client.get(f"/api/tasks/{task['id']}", headers=member_h)).status_code == 404
    submit = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=member_h, json={"body": "x"}
    )
    assert submit.status_code == 404

    # Дедлайн черновика не протекает в календарь участника.
    events = await client.get("/api/calendar/events", headers=member_h)
    assert events.status_code == 200
    assert f"Дедлайн: {task['title']}" not in [e["title"] for e in events.json()]


async def test_draft_task_visible_to_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    task = await _create_task(client, admin_h, type="common", title="Черновик", is_draft=True)
    detail = await client.get(f"/api/tasks/{task['id']}", headers=admin_h)
    assert detail.status_code == 200
    assert detail.json()["is_draft"] is True
    listed = await client.get("/api/tasks", headers=admin_h)
    assert task["id"] in [t["id"] for t in listed.json()["items"]]


async def test_draft_hides_task_even_with_publish_at_in_the_past(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """is_draft ортогонален publish_at: наступившая дата не публикует черновик."""
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    task = await _create_task(
        client, admin_h, type="common", title="Дата прошла", publish_at=past, is_draft=True
    )
    assert (await client.get(f"/api/tasks/{task['id']}", headers=member_h)).status_code == 404


async def test_unsetting_draft_publishes_task(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(client, admin_h, type="common", title="Готово", is_draft=True)
    assert (await client.get(f"/api/tasks/{task['id']}", headers=member_h)).status_code == 404

    published = await client.patch(
        f"/api/tasks/{task['id']}", headers=admin_h, json={"is_draft": False}
    )
    assert published.status_code == 200, published.text
    assert published.json()["is_draft"] is False

    got = await client.get(f"/api/tasks/{task['id']}", headers=member_h)
    assert got.status_code == 200
    listed = await client.get("/api/tasks", headers=member_h)
    assert task["id"] in [t["id"] for t in listed.json()["items"]]


async def test_published_task_can_be_returned_to_draft(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(client, admin_h, type="common", title="Опубликовано")
    assert (await client.get(f"/api/tasks/{task['id']}", headers=member_h)).status_code == 200

    hidden = await client.patch(
        f"/api/tasks/{task['id']}", headers=admin_h, json={"is_draft": True}
    )
    assert hidden.status_code == 200, hidden.text
    assert (await client.get(f"/api/tasks/{task['id']}", headers=member_h)).status_code == 404


async def test_default_is_not_draft(client: AsyncClient, make_user: MakeUser) -> None:
    """Обычное создание без флага ведёт себя как раньше — задача опубликована."""
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(client, admin_h, type="common", title="Как раньше")
    assert task["is_draft"] is False
    assert (await client.get(f"/api/tasks/{task['id']}", headers=member_h)).status_code == 200


async def test_task_library_filters_drafts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    draft = await _create_task(client, admin_h, type="common", title="Черновик в базе", is_draft=True)
    live = await _create_task(client, admin_h, type="common", title="Живая в базе")
    scheduled = await _create_task(
        client, admin_h, type="common", title="Запланированная", publish_at=_future_iso()
    )

    only_drafts = await client.get("/api/admin/tasks?state=draft", headers=admin_h)
    assert only_drafts.status_code == 200, only_drafts.text
    ids = [i["id"] for i in only_drafts.json()["items"]]
    assert draft["id"] in ids
    assert live["id"] not in ids
    assert scheduled["id"] not in ids

    # «Запланировано» — только отложенные по дате, без черновиков.
    only_scheduled = await client.get("/api/admin/tasks?state=scheduled", headers=admin_h)
    sched_ids = [i["id"] for i in only_scheduled.json()["items"]]
    assert scheduled["id"] in sched_ids
    assert draft["id"] not in sched_ids

    only_published = await client.get("/api/admin/tasks?state=published", headers=admin_h)
    pub_ids = [i["id"] for i in only_published.json()["items"]]
    assert live["id"] in pub_ids
    assert draft["id"] not in pub_ids
