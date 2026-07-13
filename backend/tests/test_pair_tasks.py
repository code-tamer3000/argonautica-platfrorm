"""Тесты парных заданий (взаимное обучение).

Админ создаёт задание type='pair', распределяя участников по парам. Внутри пары:
один участник управляет встречей (инфо-поле), каждый выдаёт партнёру перекрёстную
задачу (individual, автор — участник), приёмку ставит автор ИЛИ админ. Родительское
парное задание закрывается для пары целиком, когда обе перекрёстные приняты.

Проверяем авторизацию на каждом запросе (анти-IDOR): не-член пары не видит и не
трогает чужие пары/задачи/встречи.
"""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _make_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/07/x.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def _create_pair_task(
    client: AsyncClient, headers: dict[str, str], pairs: list[list[int]], **extra: object
) -> dict:
    resp = await client.post(
        "/api/tasks",
        headers=headers,
        json={
            "type": "pair",
            "title": "Взаимное обучение",
            "pairs": [{"user_ids": p} for p in pairs],
            **extra,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _get_task(client: AsyncClient, headers: dict[str, str], task_id: int) -> dict:
    resp = await client.get(f"/api/tasks/{task_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _my_pair(task: dict, viewer_id: int) -> dict:
    """Пара смотрящего из ответа get_task (у участника ровно одна)."""
    pairs = task["pairs"]
    for p in pairs:
        if any(m["user_id"] == viewer_id for m in p["members"]):
            return p
    raise AssertionError("viewer not in any returned pair")


# --- создание и распределение ----------------------------------------------


async def test_pair_task_requires_pairs(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    resp = await client.post(
        "/api/tasks", headers=admin_h, json={"type": "pair", "title": "x", "pairs": []}
    )
    assert resp.status_code == 422


async def test_user_in_only_one_pair(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    # a встречается в двух парах → 422.
    resp = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={
            "type": "pair",
            "title": "x",
            "pairs": [{"user_ids": [a.id, b.id]}, {"user_ids": [a.id, admin.id]}],
        },
    )
    assert resp.status_code == 422


async def test_only_pair_members_see_their_pair(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    outsider = await make_user()
    admin_h = await _headers(client, admin)

    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])

    # Участник видит задание и свою пару.
    a_task = await _get_task(client, await _headers(client, a), task["id"])
    assert a_task["type"] == "pair"
    assert len(a_task["pairs"]) == 1
    assert {m["user_id"] for m in a_task["pairs"][0]["members"]} == {a.id, b.id}

    # Посторонний (не в паре) → 403.
    out_h = await _headers(client, outsider)
    assert (
        await client.get(f"/api/tasks/{task['id']}", headers=out_h)
    ).status_code == 403

    # Задание не появляется в списке постороннего.
    listing = (await client.get("/api/tasks", headers=out_h)).json()
    assert task["id"] not in {t["id"] for t in listing["items"]}

    # Админ видит все пары.
    admin_task = await _get_task(client, admin_h, task["id"])
    assert len(admin_task["pairs"]) == 1


async def test_exactly_one_meeting_organizer(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair = (await _get_task(client, admin_h, task["id"]))["pairs"][0]
    organizers = [m for m in pair["members"] if m["is_meeting_organizer"]]
    assert len(organizers) == 1


# --- встреча ----------------------------------------------------------------


async def test_only_organizer_manages_meeting(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair = (await _get_task(client, admin_h, task["id"]))["pairs"][0]
    organizer_id = next(m["user_id"] for m in pair["members"] if m["is_meeting_organizer"])
    other_id = next(m["user_id"] for m in pair["members"] if not m["is_meeting_organizer"])
    organizer = a if a.id == organizer_id else b
    other = a if a.id == other_id else b

    url = f"/api/tasks/{task['id']}/pairs/{pair['pair_id']}/meeting"
    # Второй участник не может управлять встречей.
    resp = await client.patch(
        url, headers=await _headers(client, other), json={"meeting_at": "2026-08-01T10:00:00Z"}
    )
    assert resp.status_code == 403

    # Организатор — может назначить, перенести и отменить.
    org_h = await _headers(client, organizer)
    assert (
        await client.patch(url, headers=org_h, json={"meeting_at": "2026-08-01T10:00:00Z"})
    ).status_code == 204
    got = _my_pair(await _get_task(client, org_h, task["id"]), organizer.id)
    assert got["meeting_at"] is not None
    # Отмена.
    assert (
        await client.patch(url, headers=org_h, json={"meeting_at": None})
    ).status_code == 204
    got = _my_pair(await _get_task(client, org_h, task["id"]), organizer.id)
    assert got["meeting_at"] is None


# --- перекрёстные задачи ----------------------------------------------------


async def test_give_cross_task_once_and_edit_until_submission(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    b_h = await _headers(client, b)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    base = f"/api/tasks/{task['id']}/pairs/{pair_id}/cross-task"

    # a выдаёт задачу партнёру b.
    resp = await client.post(base, headers=a_h, json={"title": "Отработай тему X"})
    assert resp.status_code == 201, resp.text
    cross_id = resp.json()["id"]

    # Повторная выдача тем же автором → 409.
    assert (
        await client.post(base, headers=a_h, json={"title": "ещё"})
    ).status_code == 409

    # Правка до сдачи разрешена автору.
    assert (
        await client.patch(f"{base}/{cross_id}", headers=a_h, json={"title": "Новое имя"})
    ).status_code == 200
    # Не автор править не может.
    assert (
        await client.patch(f"{base}/{cross_id}", headers=b_h, json={"title": "hack"})
    ).status_code == 403

    # b (получатель) сдаёт задачу.
    assert (
        await client.post(
            f"/api/tasks/{cross_id}/submissions", headers=b_h, json={"body": "готово"}
        )
    ).status_code == 201
    # После сдачи правка запрещена (409).
    assert (
        await client.patch(f"{base}/{cross_id}", headers=a_h, json={"title": "поздно"})
    ).status_code == 409


async def test_outsider_cannot_give_cross_task(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    outsider = await make_user()
    admin_h = await _headers(client, admin)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    base = f"/api/tasks/{task['id']}/pairs/{pair_id}/cross-task"
    resp = await client.post(
        base, headers=await _headers(client, outsider), json={"title": "hack"}
    )
    assert resp.status_code == 403


# --- приёмка и завершение пары ---------------------------------------------


async def _cross_assignment_id(
    client: AsyncClient, reviewer_h: dict[str, str], cross_id: int
) -> int:
    tracks = (
        await client.get(f"/api/tasks/{cross_id}/submissions", headers=reviewer_h)
    ).json()
    assert tracks, "no submission tracks"
    return tracks[0]["assignment_id"]


async def test_cross_task_accepted_by_author_or_admin(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    b_h = await _headers(client, b)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    base = f"/api/tasks/{task['id']}/pairs/{pair_id}/cross-task"

    # a → b, b сдаёт.
    cross_ab = (await client.post(base, headers=a_h, json={"title": "AB"})).json()["id"]
    await client.post(f"/api/tasks/{cross_ab}/submissions", headers=b_h, json={"body": "ok"})
    asg = await _cross_assignment_id(client, a_h, cross_ab)

    # Не-автор и не-админ (сам получатель b) не может принять свою задачу.
    assert (
        await client.post(
            f"/api/tasks/assignments/{asg}/review", headers=b_h, json={"action": "accept"}
        )
    ).status_code == 403
    # Автор a принимает.
    assert (
        await client.post(
            f"/api/tasks/assignments/{asg}/review", headers=a_h, json={"action": "accept"}
        )
    ).status_code == 200


async def test_pair_completes_when_both_cross_tasks_accepted(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    b_h = await _headers(client, b)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    base = f"/api/tasks/{task['id']}/pairs/{pair_id}/cross-task"

    # Оба выдают и сдают.
    cross_ab = (await client.post(base, headers=a_h, json={"title": "AB"})).json()["id"]
    cross_ba = (await client.post(base, headers=b_h, json={"title": "BA"})).json()["id"]
    await client.post(f"/api/tasks/{cross_ab}/submissions", headers=b_h, json={"body": "ok"})
    await client.post(f"/api/tasks/{cross_ba}/submissions", headers=a_h, json={"body": "ok"})

    # Пока приняли только одну — родительское задание НЕ закрыто.
    asg_ab = await _cross_assignment_id(client, admin_h, cross_ab)
    await client.post(
        f"/api/tasks/assignments/{asg_ab}/review", headers=admin_h, json={"action": "accept"}
    )
    a_task = await _get_task(client, a_h, task["id"])
    assert a_task["my_status"] != "accepted"

    # Приняли вторую → родительское задание закрыто для ОБОИХ.
    asg_ba = await _cross_assignment_id(client, admin_h, cross_ba)
    await client.post(
        f"/api/tasks/assignments/{asg_ba}/review", headers=admin_h, json={"action": "accept"}
    )
    a_task = await _get_task(client, a_h, task["id"])
    b_task = await _get_task(client, b_h, task["id"])
    assert a_task["my_status"] == "accepted"
    assert b_task["my_status"] == "accepted"

    # Возврат одной перекрёстной откатывает завершённость пары.
    await client.post(
        f"/api/tasks/assignments/{asg_ba}/review",
        headers=admin_h,
        json={"action": "return", "comment": "переделай"},
    )
    a_task = await _get_task(client, a_h, task["id"])
    assert a_task["my_status"] != "accepted"


# --- админ: замена участника и удаление пары -------------------------------


async def test_replace_member_only_before_any_cross_task(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    c = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    url = f"/api/tasks/{task['id']}/pairs/{pair_id}"

    # Пока ничего не выдано — замена b на c проходит.
    resp = await client.patch(
        url, headers=admin_h, json={"old_user_id": b.id, "new_user_id": c.id}
    )
    assert resp.status_code == 204, resp.text
    members = {m["user_id"] for m in (await _get_task(client, admin_h, task["id"]))["pairs"][0]["members"]}
    assert members == {a.id, c.id}

    # a выдаёт задачу — теперь пара «активна».
    base = f"{url}/cross-task"
    assert (await client.post(base, headers=a_h, json={"title": "X"})).status_code == 201
    # Замена после выдачи → 409.
    resp = await client.patch(
        url, headers=admin_h, json={"old_user_id": c.id, "new_user_id": b.id}
    )
    assert resp.status_code == 409


async def test_delete_pair_hides_tasks(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    b_h = await _headers(client, b)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    cross = (
        await client.post(
            f"/api/tasks/{task['id']}/pairs/{pair_id}/cross-task",
            headers=a_h,
            json={"title": "X"},
        )
    ).json()

    # Участник не может удалить пару.
    assert (
        await client.delete(f"/api/tasks/{task['id']}/pairs/{pair_id}", headers=a_h)
    ).status_code == 403

    # Админ удаляет пару.
    assert (
        await client.delete(f"/api/tasks/{task['id']}/pairs/{pair_id}", headers=admin_h)
    ).status_code == 204

    # Перекрёстная задача скрыта у получателя (мягко удалена вместе с парой → 404).
    assert (
        await client.get(f"/api/tasks/{cross['id']}", headers=b_h)
    ).status_code == 404
    # Родительское задание больше не приходит участнику (назначение снято).
    listing = (await client.get("/api/tasks", headers=a_h)).json()
    assert task["id"] not in {t["id"] for t in listing["items"]}


async def test_cross_task_media_must_be_owned_by_author(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    task = await _create_pair_task(client, admin_h, [[a.id, b.id]])
    pair_id = (await _get_task(client, admin_h, task["id"]))["pairs"][0]["pair_id"]
    base = f"/api/tasks/{task['id']}/pairs/{pair_id}/cross-task"

    # Чужой ассет (владелец b) при выдаче задачи автором a → 404 (анти-IDOR).
    foreign = await _make_asset(session, b.id)
    resp = await client.post(
        base, headers=a_h, json={"title": "X", "media_asset_ids": [foreign.id]}
    )
    assert resp.status_code == 404
