"""Отложенная публикация задач (`tasks.publish_at`, база заданий): задача с
publish_at в будущем скрыта от не-админа лениво (без планировщика — см.
services/tasks.py::published_where) в списке/детали/сдаче/календаре/медиа, но
видна админу; после того как публикация наступает, она проявляется сама.

Доступ проверяется на сервере на каждом запросе (CLAUDE.md п.1).
"""
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task
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


def _past_iso(hours: int = 2) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat()


async def test_scheduled_common_task_hidden_from_participant_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(
        client, admin_h, type="common", title="Позже", publish_at=_future_iso()
    )

    listed = await client.get("/api/tasks", headers=member_h)
    assert listed.status_code == 200
    assert task["id"] not in [t["id"] for t in listed.json()["items"]]

    # Прямой запрос детали тоже скрыт (не просто выпал из списка).
    detail = await client.get(f"/api/tasks/{task['id']}", headers=member_h)
    assert detail.status_code == 404

    # Сдать нельзя — задача как будто не существует.
    submit = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=member_h, json={"body": "x"}
    )
    assert submit.status_code == 404


async def test_scheduled_task_visible_to_admin_and_marked(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    task = await _create_task(
        client, admin_h, type="common", title="Скоро", publish_at=_future_iso()
    )
    detail = await client.get(f"/api/tasks/{task['id']}", headers=admin_h)
    assert detail.status_code == 200
    assert detail.json()["publish_at"] is not None

    listed = await client.get("/api/tasks", headers=admin_h)
    assert task["id"] in [t["id"] for t in listed.json()["items"]]


async def test_scheduled_individual_task_hidden_from_assignee(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    assignee = await make_user()
    admin_h = await _headers(client, admin)
    assignee_h = await _headers(client, assignee)

    task = await _create_task(
        client,
        admin_h,
        type="individual",
        title="Персонально",
        assignee_ids=[assignee.id],
        publish_at=_future_iso(),
    )

    listed = await client.get("/api/tasks", headers=assignee_h)
    assert task["id"] not in [t["id"] for t in listed.json()["items"]]
    detail = await client.get(f"/api/tasks/{task['id']}", headers=assignee_h)
    assert detail.status_code == 404


async def test_scheduled_task_excluded_from_progress_and_attention(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    before = await client.get("/api/tasks", headers=member_h)
    before_body = before.json()

    await _create_task(
        client, admin_h, type="common", title="Позже 2", publish_at=_future_iso()
    )

    after = await client.get("/api/tasks", headers=member_h)
    after_body = after.json()
    assert after_body["progress"]["total"] == before_body["progress"]["total"]
    assert after_body["attention_count"] == before_body["attention_count"]


async def test_scheduled_task_deadline_hidden_from_calendar(
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
        title="С дедлайном",
        deadline_at=_future_iso(hours=48),
        publish_at=_future_iso(hours=1),
    )

    events = await client.get("/api/calendar/events", headers=member_h)
    assert events.status_code == 200
    titles = [e["title"] for e in events.json()]
    assert f"Дедлайн: {task['title']}" not in titles

    admin_events = await client.get("/api/calendar/events", headers=admin_h)
    admin_titles = [e["title"] for e in admin_events.json()]
    assert f"Дедлайн: {task['title']}" in admin_titles


async def test_null_publish_at_behaves_as_before(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(client, admin_h, type="common", title="Как раньше")
    assert task["publish_at"] is None

    listed = await client.get("/api/tasks", headers=member_h)
    assert task["id"] in [t["id"] for t in listed.json()["items"]]


async def test_publish_at_in_past_reveals_task_without_any_background_process(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Проверка «лениво, без планировщика»: перевод publish_at в прошлое прямой
    правкой строки — и на следующем запросе участника задача уже видна, без
    единого фонового тика."""
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(
        client, admin_h, type="common", title="Проявится сама", publish_at=_future_iso()
    )

    hidden = await client.get(f"/api/tasks/{task['id']}", headers=member_h)
    assert hidden.status_code == 404

    row = await session.scalar(select(Task).where(Task.id == task["id"]))
    assert row is not None
    row.publish_at = datetime.now(UTC) - timedelta(minutes=1)
    await session.commit()

    revealed = await client.get(f"/api/tasks/{task['id']}", headers=member_h)
    assert revealed.status_code == 200

    listed = await client.get("/api/tasks", headers=member_h)
    assert task["id"] in [t["id"] for t in listed.json()["items"]]
