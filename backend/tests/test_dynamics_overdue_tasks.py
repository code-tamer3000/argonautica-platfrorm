"""Просрочки задач как метрика Динамики (ARG-130/ARG-128): overdue_tasks/
late_submissions_count в my-stats и админ-обзоре. См. docs/TASKS.md.
"""
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task

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


async def test_admin_overview_reports_mandatory_progress(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """ARG-162: бейдж «сдано N из M обязательных» в /api/admin/dynamics."""
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin.username, "initpass123")
    user_h = await _headers(client, user.username, "initpass123")

    task_a = (
        await client.post(
            "/api/tasks",
            headers=admin_h,
            json={"type": "common", "title": "Обязательная 1"},
        )
    ).json()
    task_b = (
        await client.post(
            "/api/tasks",
            headers=admin_h,
            json={"type": "common", "title": "Обязательная 2"},
        )
    ).json()
    # Другие тесты могли уже пометить свои common-задачи обязательными (общая
    # тестовая БД, без rollback между тестами) — сравниваем ПРИРОСТ, а не
    # абсолютное число, как overdue_tasks_count/limbo_eligible выше.
    overview_before = (await client.get("/api/admin/dynamics", headers=admin_h)).json()
    total_before = next(u for u in overview_before["users"] if u["user_id"] == user.id)[
        "mandatory_progress"
    ]
    done_before, count_before = total_before if total_before else (0, 0)

    for t in (task_a, task_b):
        resp = await client.patch(
            f"/api/tasks/{t['id']}", headers=admin_h, json={"required_for_graduation": True}
        )
        assert resp.status_code == 200, resp.text

    overview = (await client.get("/api/admin/dynamics", headers=admin_h)).json()
    row = next(u for u in overview["users"] if u["user_id"] == user.id)
    assert row["mandatory_progress"] == [done_before, count_before + 2]

    submission = await client.post(
        f"/api/tasks/{task_a['id']}/submissions", headers=user_h, json={"body": "готово"}
    )
    assert submission.status_code == 201, submission.text
    assignment_id = submission.json()["assignment_id"]
    accept = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "accept"},
    )
    assert accept.status_code == 200, accept.text

    overview = (await client.get("/api/admin/dynamics", headers=admin_h)).json()
    row = next(u for u in overview["users"] if u["user_id"] == user.id)
    assert row["mandatory_progress"] == [done_before + 1, count_before + 2]


async def test_admin_overview_mandatory_progress_null_without_required_tasks(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Без обязательных заданий (среди сохранившихся, не удалённых) — прогресс
    не показываем вовсе, а не 0/0."""
    # На общей тестовой БД до этого теста могли остаться Task.required_for_graduation
    # от других тестов файла/сюиты — снимаем метку перед проверкой, иначе тест
    # зависит от порядка запуска.
    await session.execute(update(Task).values(required_for_graduation=False))
    await session.commit()

    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin.username, "initpass123")

    overview = (await client.get("/api/admin/dynamics", headers=admin_h)).json()
    row = next(u for u in overview["users"] if u["user_id"] == user.id)
    assert row["mandatory_progress"] is None
