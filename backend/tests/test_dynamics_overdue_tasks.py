"""Просрочки задач как метрика Динамики (ARG-130/ARG-128): overdue_tasks/
late_submissions_count в my-stats и админ-обзоре. См. docs/TASKS.md.
"""
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    tokens = await login(client, username, password)
    return auth_headers(tokens["access_token"])


async def test_unsubmitted_overdue_common_task_shows_in_my_stats(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin.username, "initpass123")
    user_h = await _headers(client, user.username, "initpass123")

    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    task = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Просрочена", "deadline_at": past},
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]

    stats = (await client.get("/api/dynamics/my-stats", headers=user_h)).json()
    ids = [t["task_id"] for t in stats["overdue_tasks"]]
    assert task_id in ids


async def test_accepted_task_not_counted_as_overdue(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin.username, "initpass123")
    user_h = await _headers(client, user.username, "initpass123")

    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    task = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Сдана", "deadline_at": past},
    )
    task_id = task.json()["id"]
    await client.post(
        f"/api/tasks/{task_id}/submissions", headers=user_h, json={"body": "готово"}
    )

    stats = (await client.get("/api/dynamics/my-stats", headers=user_h)).json()
    ids = [t["task_id"] for t in stats["overdue_tasks"]]
    assert task_id not in ids
    # Сдана после дедлайна — засчиталось как поздняя сдача.
    assert stats["late_submissions_count"] >= 1


async def test_admin_overview_reports_overdue_tasks_count(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin.username, "initpass123")

    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "common", "title": "Для обзора", "deadline_at": past},
    )

    overview = (await client.get("/api/admin/dynamics", headers=admin_h)).json()
    row = next(u for u in overview["users"] if u["user_id"] == user.id)
    assert row["overdue_tasks_count"] >= 1


async def test_limbo_eligible_requires_discipline_tracked_plan_and_threshold(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """limbo_eligible (ARG-132): true только на тарифе discipline_tracked=true
    И при >= 3 просроченных задачах (порог из ARG-128 «Готово, когда»)."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin.username, "initpass123")

    tracked_plan = (
        await client.post(
            "/api/admin/plans",
            headers=admin_h,
            json={"name": "Игрок", "price": 1000, "discipline_tracked": True},
        )
    ).json()
    untracked_plan = (
        await client.post(
            "/api/admin/plans",
            headers=admin_h,
            json={"name": "Спецотряд", "price": 2000, "discipline_tracked": False},
        )
    ).json()

    tracked_user = await make_user(plan_id=tracked_plan["id"])
    untracked_user = await make_user(plan_id=untracked_plan["id"])

    past = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    for i in range(3):
        await client.post(
            "/api/tasks",
            headers=admin_h,
            json={
                "type": "individual",
                "title": f"Просрочена {i}",
                "deadline_at": past,
                "assignee_ids": [tracked_user.id, untracked_user.id],
            },
        )

    overview = (await client.get("/api/admin/dynamics", headers=admin_h)).json()
    tracked_row = next(u for u in overview["users"] if u["user_id"] == tracked_user.id)
    untracked_row = next(u for u in overview["users"] if u["user_id"] == untracked_user.id)

    assert tracked_row["overdue_tasks_count"] >= 3
    assert tracked_row["limbo_eligible"] is True
    # Тот же уровень просрочки, но тариф без флага — не кандидат.
    assert untracked_row["overdue_tasks_count"] >= 3
    assert untracked_row["limbo_eligible"] is False
