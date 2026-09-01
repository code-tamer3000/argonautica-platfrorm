"""Тесты раздела «Аргонавты»: ростер потока + профиль участника.

Видимость ростера — только по потоку (правило `diary_visible`/ARG-112, не
ранговый каскад ARG-110): наблюдатели и админы исключены, сам смотрящий тоже.
`tasks_done`/`tasks` считаются по common-задачам, видимым СМОТРЯЩЕМУ (двойной
фильтр поток+тариф, ARG-96) — задача чужого тарифа не должна попасть в счётчик
чужого участника, даже если у него самого этот тариф есть.
"""
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.argonauts import EXPEDITION_FEAT_TASK_TITLE, OBSERVER_TARIFF_NAME
from app.models.room import Room
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _create_plan(client: AsyncClient, headers: dict[str, str], name: str) -> int:
    resp = await client.post(
        "/api/admin/plans", headers=headers, json={"name": name, "price": 1000}
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


async def _submit_and_review(
    client: AsyncClient,
    admin_h: dict[str, str],
    user_h: dict[str, str],
    task_id: int,
    action: str,
) -> None:
    resp = await client.post(
        f"/api/tasks/{task_id}/submissions", headers=user_h, json={"body": "x"}
    )
    assert resp.status_code == 201, resp.text
    tracks = (
        await client.get(f"/api/tasks/{task_id}/submissions", headers=admin_h)
    ).json()
    assignment_id = tracks[0]["assignment_id"]
    review = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": action} if action == "accept" else {"action": action, "comment": "x"},
    )
    assert review.status_code == 200, review.text


async def _make_personal_room(session: AsyncSession, owner_id: int) -> Room:
    room = Room(type="channel", name="Дневник", is_personal=True, created_by=owner_id)
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


# --- состав ростера ----------------------------------------------------------


async def test_roster_same_intake_only(client: AsyncClient, make_user: MakeUser) -> None:
    starts_on = date.today() - timedelta(days=200)
    viewer = await make_user(intake_starts_on=starts_on)
    same_intake = await make_user(intake_id=viewer.intake_id)
    other_intake = await make_user(intake_starts_on=date.today() - timedelta(days=1))

    viewer_h = await _headers(client, viewer)
    resp = await client.get("/api/argonauts", headers=viewer_h)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert same_intake.id in ids
    assert other_intake.id not in ids
    assert viewer.id not in ids  # сам смотрящий не в списке


async def test_roster_excludes_observer_includes_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Наблюдатель — вне ростера целиком; админ — в ростере (отдельная секция на
    фронте по role), но без задач (tasks_done=0 у него по построению)."""
    starts_on = date.today() - timedelta(days=201)
    viewer = await make_user(intake_starts_on=starts_on)
    observer = await make_user(intake_id=viewer.intake_id, is_observer=True)
    admin = await make_user(intake_id=viewer.intake_id, role="admin")

    viewer_h = await _headers(client, viewer)
    resp = await client.get("/api/argonauts", headers=viewer_h)
    rows = resp.json()
    ids = {row["id"] for row in rows}
    assert observer.id not in ids
    assert admin.id in ids
    admin_row = next(r for r in rows if r["id"] == admin.id)
    assert admin_row["role"] == "admin"
    assert admin_row["tasks_done"] == 0
    # Админы хвостовым блоком (см. _roster) — после всех участников с рангом.
    admin_index = next(i for i, r in enumerate(rows) if r["id"] == admin.id)
    assert all(r["role"] != "admin" for r in rows[:admin_index])


async def test_roster_excludes_observer_tariff_holders(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Тариф «Наблюдатель» (OBSERVER_TARIFF_NAME) и флаг is_observer — ДВЕ разные
    вещи (флаг ставится за пропуски, тариф покупается с начала); держатель
    тарифа без флага всё равно исключён из ростера целиком."""
    starts_on = date.today() - timedelta(days=212)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    observer_plan = await _create_plan(client, admin_h, OBSERVER_TARIFF_NAME)

    viewer = await make_user(intake_id=admin.intake_id)
    tariff_observer = await make_user(
        intake_id=admin.intake_id, plan_id=observer_plan, is_observer=False
    )
    no_plan = await make_user(intake_id=admin.intake_id, plan_id=None)

    viewer_h = await _headers(client, viewer)
    resp = await client.get("/api/argonauts", headers=viewer_h)
    ids = {row["id"] for row in resp.json()}
    assert tariff_observer.id not in ids
    # Без тарифа вообще (plan_id NULL) — это НЕ «Наблюдатель», остаётся в ростере.
    assert no_plan.id in ids


async def test_observer_cannot_access_section(client: AsyncClient, make_user: MakeUser) -> None:
    observer = await make_user(is_observer=True)
    other = await make_user(intake_id=observer.intake_id)
    observer_h = await _headers(client, observer)

    assert (await client.get("/api/argonauts", headers=observer_h)).status_code == 403
    assert (
        await client.get(f"/api/argonauts/{other.id}", headers=observer_h)
    ).status_code == 403


async def test_detail_of_other_intake_is_404(client: AsyncClient, make_user: MakeUser) -> None:
    viewer = await make_user(intake_starts_on=date.today() - timedelta(days=202))
    stranger = await make_user(intake_starts_on=date.today() - timedelta(days=2))

    viewer_h = await _headers(client, viewer)
    resp = await client.get(f"/api/argonauts/{stranger.id}", headers=viewer_h)
    assert resp.status_code == 404


async def test_admin_detail_has_no_diary_link(client: AsyncClient, make_user: MakeUser) -> None:
    """Личный канал админа не проходит diary_visible (owner.role != 'admin') —
    ссылка вела бы на 403, поэтому эндпоинт её не отдаёт."""
    starts_on = date.today() - timedelta(days=207)
    viewer = await make_user(intake_starts_on=starts_on)
    admin = await make_user(intake_id=viewer.intake_id, role="admin")

    viewer_h = await _headers(client, viewer)
    detail = (await client.get(f"/api/argonauts/{admin.id}", headers=viewer_h)).json()
    assert detail["role"] == "admin"
    assert detail["diary_room_id"] is None
    assert detail["tasks"] == []


# --- tasks_done / детальный список задач --------------------------------------


async def test_tasks_done_counts_only_accepted_visible_common(
    client: AsyncClient, make_user: MakeUser
) -> None:
    starts_on = date.today() - timedelta(days=203)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    viewer = await make_user(intake_id=admin.intake_id)
    target = await make_user(intake_id=admin.intake_id)
    viewer_h = await _headers(client, viewer)
    target_h = await _headers(client, target)

    accepted_task = await _create_common_task(client, admin_h, "Принята")
    submitted_task = await _create_common_task(client, admin_h, "На проверке")
    await _submit_and_review(client, admin_h, target_h, accepted_task, "accept")
    resp = await client.post(
        f"/api/tasks/{submitted_task}/submissions", headers=target_h, json={"body": "x"}
    )
    assert resp.status_code == 201

    listed = (await client.get("/api/argonauts", headers=viewer_h)).json()
    row = next(r for r in listed if r["id"] == target.id)
    assert row["tasks_done"] == 1  # только accepted, не submitted


async def test_tasks_done_ignores_task_of_foreign_plan(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Задача видна тарифу B — viewer тарифа A её не видит вообще, значит и не
    должен видеть/считать чужое принятие этой задачи в ростере, хотя у target
    (тариф B) она честно принята."""
    starts_on = date.today() - timedelta(days=204)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    plan_b = await _create_plan(client, admin_h, "Тариф Б")

    viewer = await make_user(intake_id=admin.intake_id, plan_id=None)
    target = await make_user(intake_id=admin.intake_id, plan_id=plan_b)
    target_h = await _headers(client, target)
    viewer_h = await _headers(client, viewer)

    task_id = await _create_common_task(
        client, admin_h, "Только тариф Б", plan_ids=[plan_b]
    )
    await _submit_and_review(client, admin_h, target_h, task_id, "accept")

    listed = (await client.get("/api/argonauts", headers=viewer_h)).json()
    row = next(r for r in listed if r["id"] == target.id)
    assert row["tasks_done"] == 0

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["tasks_done"] == 0
    assert detail["tasks"] == []


async def test_detail_tasks_include_accepted_and_submitted_not_returned(
    client: AsyncClient, make_user: MakeUser
) -> None:
    starts_on = date.today() - timedelta(days=205)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    viewer = await make_user(intake_id=admin.intake_id)
    target = await make_user(intake_id=admin.intake_id)
    viewer_h = await _headers(client, viewer)
    target_h = await _headers(client, target)

    accepted_task = await _create_common_task(client, admin_h, "Принята-2")
    submitted_task = await _create_common_task(client, admin_h, "Сдана-2")
    returned_task = await _create_common_task(client, admin_h, "Возвращена-2")
    await _submit_and_review(client, admin_h, target_h, accepted_task, "accept")
    await client.post(
        f"/api/tasks/{submitted_task}/submissions", headers=target_h, json={"body": "x"}
    )
    await _submit_and_review(client, admin_h, target_h, returned_task, "return")

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    titles = {t["title"] for t in detail["tasks"]}
    assert "Принята-2" in titles
    assert "Сдана-2" in titles
    assert "Возвращена-2" not in titles
    assert detail["tasks_done"] == 1


# --- diary_room_id -------------------------------------------------------------


async def test_diary_room_id_matches_personal_room(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    starts_on = date.today() - timedelta(days=206)
    viewer = await make_user(intake_starts_on=starts_on)
    target = await make_user(intake_id=viewer.intake_id)
    room = await _make_personal_room(session, target.id)

    viewer_h = await _headers(client, viewer)
    listed = (await client.get("/api/argonauts", headers=viewer_h)).json()
    row = next(r for r in listed if r["id"] == target.id)

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["diary_room_id"] == room.id
    # плитка не несёт diary_room_id (только детальная страница) — но проверим id совпадает.
    assert row["id"] == target.id


# --- expedition_feat -----------------------------------------------------------


async def _create_individual_task(
    client: AsyncClient, headers: dict[str, str], title: str, assignee_id: int, **extra: object
) -> int:
    resp = await client.post(
        "/api/tasks",
        headers=headers,
        json={"type": "individual", "title": title, "assignee_ids": [assignee_id], **extra},
    )
    assert resp.status_code == 201, resp.text
    return int(resp.json()["id"])


async def test_expedition_feat_shows_latest_submission_any_status(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """На проде EXPEDITION_FEAT_TASK_TITLE — individual-задание каждому участнику
    потока (не common) — воспроизводим это в тесте, не common-вариант."""
    starts_on = date.today() - timedelta(days=208)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    viewer = await make_user(intake_id=admin.intake_id)
    target = await make_user(intake_id=admin.intake_id)
    viewer_h = await _headers(client, viewer)
    target_h = await _headers(client, target)

    task_id = await _create_individual_task(
        client, admin_h, EXPEDITION_FEAT_TASK_TITLE, target.id
    )
    # Первая сдача — возвращена, вторая (более поздняя) — на проверке. Поле должно
    # показать текст ВТОРОЙ (последней), а не первой, независимо от статуса.
    await client.post(
        f"/api/tasks/{task_id}/submissions", headers=target_h, json={"body": "первый черновик"}
    )
    tracks = (
        await client.get(f"/api/tasks/{task_id}/submissions", headers=admin_h)
    ).json()
    await client.post(
        f"/api/tasks/assignments/{tracks[0]['assignment_id']}/review",
        headers=admin_h,
        json={"action": "return", "comment": "доработай"},
    )
    await client.post(
        f"/api/tasks/{task_id}/submissions", headers=target_h, json={"body": "финальный ответ"}
    )

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["expedition_feat"] == "финальный ответ"
    # После возврата на доработку и новой сдачи статус СНОВА 'submitted' — фронту
    # нужен именно текущий статус назначения, чтобы решить, открыт ли TaskComposer.
    assert detail["expedition_feat_task_id"] == task_id
    assert detail["expedition_feat_status"] == "submitted"


async def test_expedition_feat_status_assigned_before_first_submission(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Назначение есть, сдачи ещё не было — task_id отдан (чтобы фронт мог сразу
    показать композер владельцу), текст null, статус 'assigned'."""
    starts_on = date.today() - timedelta(days=213)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    viewer = await make_user(intake_id=admin.intake_id)
    target = await make_user(intake_id=admin.intake_id)
    viewer_h = await _headers(client, viewer)

    task_id = await _create_individual_task(
        client, admin_h, EXPEDITION_FEAT_TASK_TITLE, target.id
    )

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["expedition_feat"] is None
    assert detail["expedition_feat_task_id"] == task_id
    assert detail["expedition_feat_status"] == "assigned"


async def test_expedition_feat_task_id_null_without_assignment(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Задача существует и видна потоку (по intake-метке), но у ЭТОГО конкретного
    участника нет строки назначения (не был выбран assignee) — всё null."""
    starts_on = date.today() - timedelta(days=214)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    viewer = await make_user(intake_id=admin.intake_id)
    other = await make_user(intake_id=admin.intake_id)
    target = await make_user(intake_id=admin.intake_id)
    viewer_h = await _headers(client, viewer)

    # Назначена ДРУГОМУ участнику потока, не target.
    await _create_individual_task(client, admin_h, EXPEDITION_FEAT_TASK_TITLE, other.id)

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["expedition_feat"] is None
    assert detail["expedition_feat_task_id"] is None
    assert detail["expedition_feat_status"] is None


async def test_expedition_feat_null_when_no_submission_or_no_such_task(
    client: AsyncClient, make_user: MakeUser
) -> None:
    starts_on = date.today() - timedelta(days=209)
    viewer = await make_user(intake_starts_on=starts_on)
    target = await make_user(intake_id=viewer.intake_id)
    viewer_h = await _headers(client, viewer)

    # Задачи EXPEDITION_FEAT_TASK_TITLE в этом потоке вообще нет.
    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["expedition_feat"] is None
    assert detail["expedition_feat_task_id"] is None
    assert detail["expedition_feat_status"] is None


async def test_expedition_feat_ignores_other_intakes_task(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Одноимённая individual-задача в ДРУГОМ потоке (свой intake_id-ярлык на
    задаче) не должна протечь в профиль участника этого потока."""
    starts_on = date.today() - timedelta(days=211)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    other_admin = await make_user(
        role="admin", intake_starts_on=date.today() - timedelta(days=3)
    )
    other_admin_h = await _headers(client, other_admin)

    viewer = await make_user(intake_id=admin.intake_id)
    target = await make_user(intake_id=admin.intake_id)
    viewer_h = await _headers(client, viewer)

    # Задача с тем же заголовком, но выдана как individual в ЧУЖОМ потоке
    # (intake_id того потока) — для другого пользователя, а не для target.
    outsider = await make_user(intake_id=other_admin.intake_id)
    outsider_h = await _headers(client, outsider)
    other_task_id = await _create_individual_task(
        client, other_admin_h, EXPEDITION_FEAT_TASK_TITLE, outsider.id,
        intake_id=other_admin.intake_id,
    )
    await client.post(
        f"/api/tasks/{other_task_id}/submissions", headers=outsider_h, json={"body": "чужой ответ"}
    )

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=viewer_h)).json()
    assert detail["expedition_feat"] is None
