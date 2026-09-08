"""Тесты раздела «Аргонавты»: ростер потока + профиль участника.

Видимость ростера — только по потоку (правило `diary_visible`/ARG-112, не
ранговый каскад ARG-110): исключён только сам смотрящий; админы идут первым
блоком, наблюдатели (флаг ЛИБО тариф) — последним, с `is_observer=true`.
`tasks_done`/`tasks` считаются по common-задачам, уже сданным/принятым
ХОЗЯИНОМ карточки (`_completed_common_where`) — тариф стороннего смотрящего
всё ещё фильтрует (задача чужого тарифа не должна течь постороннему), но НЕ
фильтрует для самого владельца карточки и для админа: их «назначение/оверсайт
сильнее тарифа», см. docs/TASKS.md "Tariff change cleanup".
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
    assert viewer.id in ids  # ARG-119: своя плитка тоже в общем ростере


async def test_own_detail_page_resolves(client: AsyncClient, make_user: MakeUser) -> None:
    """ARG-119: своя плитка резолвится через GET /api/argonauts/{myId} (раньше
    404-ила, потому что `_roster` исключала смотрящего)."""
    viewer = await make_user()
    viewer_h = await _headers(client, viewer)
    resp = await client.get(f"/api/argonauts/{viewer.id}", headers=viewer_h)
    assert resp.status_code == 200
    assert resp.json()["id"] == viewer.id


async def test_roster_admins_first_observers_last(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Три блока: админы — первыми, участники — в середине, наблюдатели — хвостом.
    Админ без задач (tasks_done=0 у него по построению)."""
    starts_on = date.today() - timedelta(days=201)
    # display_name distinct from make_user's default ("Test User") — иначе
    # viewer/member делят один тай-брейк по имени и порядок между ними не задан.
    viewer = await make_user(intake_starts_on=starts_on, display_name="ZZZ Viewer")
    observer = await make_user(intake_id=viewer.intake_id, is_observer=True)
    member = await make_user(intake_id=viewer.intake_id)
    admin = await make_user(intake_id=viewer.intake_id, role="admin")

    viewer_h = await _headers(client, viewer)
    resp = await client.get("/api/argonauts", headers=viewer_h)
    rows = resp.json()
    order = [r["id"] for r in rows]
    assert order == [admin.id, member.id, viewer.id, observer.id]
    admin_row, member_row, viewer_row, observer_row = rows
    assert admin_row["role"] == "admin"
    assert admin_row["tasks_done"] == 0
    assert admin_row["is_observer"] is False
    assert member_row["is_observer"] is False
    assert viewer_row["id"] == viewer.id
    assert observer_row["is_observer"] is True


async def test_roster_observer_tariff_holders_in_observer_block(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Тариф «Наблюдатель» (OBSERVER_TARIFF_NAME) и флаг is_observer — ДВЕ разные
    вещи (флаг ставится за пропуски, тариф покупается с начала); держатель тарифа
    без флага всё равно попадает в хвостовую секцию наблюдателей."""
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
    rows = resp.json()
    by_id = {r["id"]: r for r in rows}
    assert by_id[tariff_observer.id]["is_observer"] is True
    # Без тарифа вообще (plan_id NULL) — это НЕ «Наблюдатель», обычный участник.
    assert by_id[no_plan.id]["is_observer"] is False
    assert rows[-1]["id"] == tariff_observer.id


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
    """Личный канал админа по умолчанию (`diary_public=False`) не проходит
    diary_visible — ссылка вела бы на 403, поэтому эндпоинт её не отдаёт."""
    starts_on = date.today() - timedelta(days=207)
    viewer = await make_user(intake_starts_on=starts_on)
    admin = await make_user(intake_id=viewer.intake_id, role="admin")

    viewer_h = await _headers(client, viewer)
    detail = (await client.get(f"/api/argonauts/{admin.id}", headers=viewer_h)).json()
    assert detail["role"] == "admin"
    assert detail["diary_room_id"] is None
    assert detail["tasks"] == []


async def test_admin_detail_has_diary_link_when_diary_public(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    """`diary_public=True` — эндпоинт отдаёт ссылку на дневник этого админа
    участнику того же потока (`diary_visible` теперь проходит)."""
    starts_on = date.today() - timedelta(days=208)
    viewer = await make_user(intake_starts_on=starts_on)
    admin = await make_user(intake_id=viewer.intake_id, role="admin", diary_public=True)
    room = await _make_personal_room(session, admin.id)

    viewer_h = await _headers(client, viewer)
    detail = (await client.get(f"/api/argonauts/{admin.id}", headers=viewer_h)).json()
    assert detail["diary_room_id"] == room.id


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
    # ARG-119: текст сдачи виден прямо в строке, без перехода на /tasks/{id}.
    by_title = {t["title"]: t for t in detail["tasks"]}
    assert by_title["Принята-2"]["submission_text"] == "x"
    assert by_title["Сдана-2"]["submission_text"] == "x"


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


# --- can_message: зеркало assert_peer_visible/contact_visible (ARG-110) -------


async def _three_tier_cohort(
    client: AsyncClient, make_user: MakeUser, starts_on: date
) -> dict[str, User]:
    """Один поток, три тарифа по возрастанию цены — по одному участнику каждого,
    плюс не-навигатор и навигатор админ (см. test_rank_visibility.py, тот же
    паттерн, локальная копия — не тащим межмодульный импорт ради одного хелпера).
    """
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    plan_player = await _create_plan(client, admin_h, "Игрок")
    plan_squad = await _create_plan(client, admin_h, "Спецотряд")
    plan_oko = await _create_plan(client, admin_h, "Око")

    player = await make_user(intake_id=admin.intake_id, plan_id=plan_player)
    squad = await make_user(intake_id=admin.intake_id, plan_id=plan_squad)
    oko = await make_user(intake_id=admin.intake_id, plan_id=plan_oko)
    navigator = await make_user(
        role="admin", intake_id=admin.intake_id, is_navigator=True
    )
    return {
        "admin": admin,
        "player": player,
        "squad": squad,
        "oko": oko,
        "navigator": navigator,
    }


async def test_can_message_false_below_rank(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Младший по тарифу не видит кнопку у старшего — та же граница, что и на
    записи (assert_peer_visible бы 403-нул POST /api/rooms)."""
    starts_on = date.today() - timedelta(days=220)
    users = await _three_tier_cohort(client, make_user, starts_on)
    player_h = await _headers(client, users["player"])

    detail = (
        await client.get(f"/api/argonauts/{users['oko'].id}", headers=player_h)
    ).json()
    assert detail["can_message"] is False


async def test_can_message_true_above_or_equal_rank(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Старший по тарифу и равный по тарифу — обе стороны True (равный ранг —
    "<=" из contact_visible)."""
    starts_on = date.today() - timedelta(days=221)
    users = await _three_tier_cohort(client, make_user, starts_on)
    oko_h = await _headers(client, users["oko"])

    detail_lower = (
        await client.get(f"/api/argonauts/{users['player'].id}", headers=oko_h)
    ).json()
    assert detail_lower["can_message"] is True

    another_player = await make_user(
        intake_id=users["admin"].intake_id, plan_id=users["player"].plan_id
    )
    peer_detail = (
        await client.get(
            f"/api/argonauts/{another_player.id}", headers=await _headers(client, users["player"])
        )
    ).json()
    assert peer_detail["can_message"] is True


async def test_can_message_admin_only_top_two_tariffs(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Обычный (не-навигатор) админ виден в контактах только топ-2 тарифов потока
    (can_message_admin) — здесь то же правило, отражённое в профиле админа."""
    starts_on = date.today() - timedelta(days=222)
    users = await _three_tier_cohort(client, make_user, starts_on)

    player_view = (
        await client.get(
            f"/api/argonauts/{users['admin'].id}", headers=await _headers(client, users["player"])
        )
    ).json()
    assert player_view["can_message"] is False

    oko_view = (
        await client.get(
            f"/api/argonauts/{users['admin'].id}", headers=await _headers(client, users["oko"])
        )
    ).json()
    assert oko_view["can_message"] is True


async def test_can_message_navigator_visible_to_everyone(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """is_navigator обходит правило топ-2 тарифов — виден абсолютно всем."""
    starts_on = date.today() - timedelta(days=223)
    users = await _three_tier_cohort(client, make_user, starts_on)

    player_view = (
        await client.get(
            f"/api/argonauts/{users['navigator'].id}",
            headers=await _headers(client, users["player"]),
        )
    ).json()
    assert player_view["can_message"] is True


async def test_can_message_admin_viewer_unrestricted(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Смотрящий-админ не ограничен рангом — видит can_message=True для любого."""
    starts_on = date.today() - timedelta(days=224)
    users = await _three_tier_cohort(client, make_user, starts_on)
    admin_h = await _headers(client, users["admin"])

    detail = (
        await client.get(f"/api/argonauts/{users['player'].id}", headers=admin_h)
    ).json()
    assert detail["can_message"] is True


# --- держатель дешёвого тарифа: раздел закрыт целиком -------------------------


async def test_cheap_tariff_holder_cannot_access_section(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """CHEAP_TARIFF_NAME ("Наблюдатель") закрывает раздел так же, как
    is_observer — отдельная проверка `_deny_cheap_tariff`, держатель этого
    тарифа при этом БЕЗ флага is_observer (иначе это тест на require_participant,
    не на новую зависимость)."""
    starts_on = date.today() - timedelta(days=225)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    cheap_plan = await _create_plan(client, admin_h, OBSERVER_TARIFF_NAME)

    cheap_user = await make_user(
        intake_id=admin.intake_id, plan_id=cheap_plan, is_observer=False
    )
    other = await make_user(intake_id=admin.intake_id)
    cheap_h = await _headers(client, cheap_user)

    assert (await client.get("/api/argonauts", headers=cheap_h)).status_code == 403
    assert (
        await client.get(f"/api/argonauts/{other.id}", headers=cheap_h)
    ).status_code == 403


# --- сданная задача переживает понижение тарифа (владелец и админ) ------------


async def test_own_completed_task_survives_downgrade(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Владелец карточки видит СВОЮ уже принятую тарифную задачу на своей же
    странице «Аргонавты» даже после того как его понизили — `_completed_common_where`
    не фильтрует по тарифу СМОТРЯЩЕГО, если смотрящий и есть владелец."""
    starts_on = date.today() - timedelta(days=206)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    plan_b = await _create_plan(client, admin_h, "Тариф Б")
    target = await make_user(intake_id=admin.intake_id, plan_id=plan_b)
    target_h = await _headers(client, target)

    task_id = await _create_common_task(
        client, admin_h, "Только тариф Б", plan_ids=[plan_b]
    )
    await _submit_and_review(client, admin_h, target_h, task_id, "accept")

    patched = await client.patch(
        f"/api/admin/users/{target.id}", headers=admin_h, json={"plan_id": None}
    )
    assert patched.status_code == 200

    listed = (await client.get("/api/argonauts", headers=target_h)).json()
    own_row = next(r for r in listed if r["id"] == target.id)
    assert own_row["tasks_done"] == 1

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=target_h)).json()
    assert detail["tasks_done"] == 1
    assert task_id in {t["task_id"] for t in detail["tasks"]}


async def test_admin_sees_completed_task_regardless_of_own_plan(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Админ (обычно без тарифа вовсе) видит чужую принятую тарифную задачу на
    карточке участника — тот же безусловный оверсайт, что и везде на платформе.
    Контраст с `test_tasks_done_ignores_task_of_foreign_plan`: там смотрящий —
    обычный участник без тарифа, и для НЕГО фильтр остаётся в силе."""
    starts_on = date.today() - timedelta(days=207)
    admin = await make_user(role="admin", intake_starts_on=starts_on)
    admin_h = await _headers(client, admin)
    plan_b = await _create_plan(client, admin_h, "Тариф Б")
    target = await make_user(intake_id=admin.intake_id, plan_id=plan_b)
    target_h = await _headers(client, target)

    task_id = await _create_common_task(
        client, admin_h, "Только тариф Б", plan_ids=[plan_b]
    )
    await _submit_and_review(client, admin_h, target_h, task_id, "accept")

    listed = (await client.get("/api/argonauts", headers=admin_h)).json()
    row = next(r for r in listed if r["id"] == target.id)
    assert row["tasks_done"] == 1

    detail = (await client.get(f"/api/argonauts/{target.id}", headers=admin_h)).json()
    assert detail["tasks_done"] == 1
    assert task_id in {t["task_id"] for t in detail["tasks"]}
