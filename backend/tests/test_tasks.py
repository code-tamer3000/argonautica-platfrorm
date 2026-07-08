"""Тесты раздела «Задачи»: admin-only CRUD, видимость common/individual (анти-IDOR),
жизненный цикл сдачи, флаг late, прогресс X/Y, «требует внимания», авто-событие
календаря с адресной видимостью, доступ к медиа сдачи.

Доступ проверяется на сервере на каждом запросе (CLAUDE.md п.1). MediaAsset сидим
прямо через session (MinIO не нужен — presigned_get_url подписывает URL локально).
"""
from datetime import UTC, datetime, timedelta

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


async def _create_task(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/tasks", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- admin-only CRUD --------------------------------------------------------


async def test_participant_cannot_create_edit_delete(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    task = await _create_task(client, admin_h, type="common", title="A")

    assert (
        await client.post(
            "/api/tasks", headers=member_h, json={"type": "common", "title": "x"}
        )
    ).status_code == 403
    assert (
        await client.patch(
            f"/api/tasks/{task['id']}", headers=member_h, json={"title": "y"}
        )
    ).status_code == 403
    assert (
        await client.delete(f"/api/tasks/{task['id']}", headers=member_h)
    ).status_code == 403


async def test_individual_requires_assignees(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    # Пустой список адресатов → 422.
    resp = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "individual", "title": "no one"},
    )
    assert resp.status_code == 422

    # Несуществующий адресат → 422.
    resp = await client.post(
        "/api/tasks",
        headers=admin_h,
        json={"type": "individual", "title": "ghost", "assignee_ids": [999999]},
    )
    assert resp.status_code == 422


async def test_update_and_delete(client: AsyncClient, make_user: MakeUser) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)

    task = await _create_task(client, admin_h, type="common", title="old")
    patched = await client.patch(
        f"/api/tasks/{task['id']}", headers=admin_h, json={"title": "new"}
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "new"

    deleted = await client.delete(f"/api/tasks/{task['id']}", headers=admin_h)
    assert deleted.status_code == 204
    gone = await client.get(f"/api/tasks/{task['id']}", headers=admin_h)
    assert gone.status_code == 404


# --- видимость / IDOR -------------------------------------------------------


async def test_individual_visibility_and_idor(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    assignee = await make_user()
    outsider = await make_user()
    admin_h = await _headers(client, admin)
    assignee_h = await _headers(client, assignee)
    outsider_h = await _headers(client, outsider)

    task = await _create_task(
        client,
        admin_h,
        type="individual",
        title="Private",
        assignee_ids=[assignee.id],
    )
    tid = task["id"]

    # Адресат и админ видят задачу; посторонний — 403 (перебор id = IDOR).
    assert (await client.get(f"/api/tasks/{tid}", headers=assignee_h)).status_code == 200
    assert (await client.get(f"/api/tasks/{tid}", headers=admin_h)).status_code == 200
    assert (await client.get(f"/api/tasks/{tid}", headers=outsider_h)).status_code == 403
    # Список постороннего не содержит чужую индивидуальную задачу.
    listed = await client.get("/api/tasks", headers=outsider_h)
    assert tid not in {t["id"] for t in listed.json()["items"]}
    # Адресат ВИДИТ выданную ему индивидуальную задачу в своём списке.
    assignee_listed = await client.get("/api/tasks", headers=assignee_h)
    assert tid in {t["id"] for t in assignee_listed.json()["items"]}
    # Админ (автор, не адресат) тоже видит её в списке — иначе не оценить прогресс.
    admin_listed = await client.get("/api/tasks", headers=admin_h)
    assert tid in {t["id"] for t in admin_listed.json()["items"]}
    # Сдачи чужой задачи посторонний тоже не видит.
    assert (
        await client.get(f"/api/tasks/{tid}/submissions", headers=outsider_h)
    ).status_code == 403


async def test_common_submissions_public_individual_private(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    a = await make_user()
    b = await make_user()
    admin_h = await _headers(client, admin)
    a_h = await _headers(client, a)
    b_h = await _headers(client, b)

    common = await _create_task(client, admin_h, type="common", title="Common")
    # a сдаёт общую задачу.
    resp = await client.post(
        f"/api/tasks/{common['id']}/submissions", headers=a_h, json={"body": "done"}
    )
    assert resp.status_code == 201
    # b видит трек a (общие сдачи публичны).
    tracks = await client.get(f"/api/tasks/{common['id']}/submissions", headers=b_h)
    assert tracks.status_code == 200
    assert any(t["user_id"] == a.id for t in tracks.json())

    # Индивидуальная: участник видит только свой трек, админ — все.
    indiv = await _create_task(
        client,
        admin_h,
        type="individual",
        title="Indiv",
        assignee_ids=[a.id, b.id],
    )
    await client.post(
        f"/api/tasks/{indiv['id']}/submissions", headers=a_h, json={"body": "mine"}
    )
    a_tracks = (
        await client.get(f"/api/tasks/{indiv['id']}/submissions", headers=a_h)
    ).json()
    assert {t["user_id"] for t in a_tracks} == {a.id}
    admin_tracks = (
        await client.get(f"/api/tasks/{indiv['id']}/submissions", headers=admin_h)
    ).json()
    assert {a.id, b.id} <= {t["user_id"] for t in admin_tracks}


# --- жизненный цикл сдачи ----------------------------------------------------


async def test_submission_lifecycle(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    task = await _create_task(
        client, admin_h, type="individual", title="Cycle", assignee_ids=[user.id]
    )
    tid = task["id"]

    # assigned → submitted
    assert (await client.get(f"/api/tasks/{tid}", headers=user_h)).json()[
        "my_status"
    ] == "assigned"
    await client.post(f"/api/tasks/{tid}/submissions", headers=user_h, json={"body": "v1"})
    assert (await client.get(f"/api/tasks/{tid}", headers=user_h)).json()[
        "my_status"
    ] == "submitted"

    # admin возвращает (с комментарием) → returned + комментарий на последней сдаче
    tracks = (
        await client.get(f"/api/tasks/{tid}/submissions", headers=admin_h)
    ).json()
    assignment_id = tracks[0]["assignment_id"]
    submission_id = tracks[0]["submissions"][-1]["id"]
    # возврат без комментария — 422
    bad = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "return"},
    )
    assert bad.status_code == 422
    ret = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "return", "comment": "переделать"},
    )
    assert ret.status_code == 200
    assert ret.json()["status"] == "returned"
    comments = (
        await client.get(
            f"/api/tasks/submissions/{submission_id}/comments", headers=user_h
        )
    ).json()
    assert any(c["body"] == "переделать" for c in comments)

    # returned → submitted (повторная сдача) → accepted
    await client.post(f"/api/tasks/{tid}/submissions", headers=user_h, json={"body": "v2"})
    assert (await client.get(f"/api/tasks/{tid}", headers=user_h)).json()[
        "my_status"
    ] == "submitted"
    acc = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "accept"},
    )
    assert acc.status_code == 200
    assert acc.json()["status"] == "accepted"


async def test_submission_must_carry_content(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)
    task = await _create_task(client, admin_h, type="common", title="C")
    empty = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={}
    )
    assert empty.status_code == 422


async def test_late_flag_when_deadline_passed(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    task = await _create_task(
        client,
        admin_h,
        type="individual",
        title="Overdue",
        assignee_ids=[user.id],
        deadline_at=past,
    )
    await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "late"}
    )
    got = (await client.get(f"/api/tasks/{task['id']}", headers=user_h)).json()
    assert got["late"] is True


# --- прогресс / внимание -----------------------------------------------------


async def test_progress_and_attention(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    # Базовый прогресс (БД тестов общая — common-задачи из других тестов копятся,
    # поэтому меряем прирост, а не абсолют).
    base = (await client.get("/api/tasks", headers=user_h)).json()["progress"]

    # 1 общая + 1 индивидуальная задача юзеру → total прирастает на 2.
    common = await _create_task(client, admin_h, type="common", title="C")
    indiv = await _create_task(
        client, admin_h, type="individual", title="I", assignee_ids=[user.id]
    )

    listed = (await client.get("/api/tasks", headers=user_h)).json()
    assert listed["progress"]["total"] == base["total"] + 2
    assert listed["progress"]["done"] == base["done"]
    # Непочатая общая задача попадает в «требует внимания».
    assert listed["attention_count"] >= 1

    # Сдаём и принимаем индивидуальную → done растёт.
    tracks = (
        await client.get(f"/api/tasks/{indiv['id']}/submissions", headers=admin_h)
    )
    await client.post(
        f"/api/tasks/{indiv['id']}/submissions", headers=user_h, json={"body": "x"}
    )
    tracks = (
        await client.get(f"/api/tasks/{indiv['id']}/submissions", headers=admin_h)
    ).json()
    assignment_id = tracks[0]["assignment_id"]
    await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "accept"},
    )
    listed2 = (await client.get("/api/tasks", headers=user_h)).json()
    assert listed2["progress"]["done"] == base["done"] + 1

    # Возврат общей задачи → attention отражает returned.
    await client.post(
        f"/api/tasks/{common['id']}/submissions", headers=user_h, json={"body": "c1"}
    )
    ctracks = (
        await client.get(f"/api/tasks/{common['id']}/submissions", headers=admin_h)
    ).json()
    caid = ctracks[0]["assignment_id"]
    await client.post(
        f"/api/tasks/assignments/{caid}/review",
        headers=admin_h,
        json={"action": "return", "comment": "again"},
    )
    listed3 = (await client.get("/api/tasks", headers=user_h)).json()
    assert listed3["attention_count"] >= 1


# --- календарь: авто-событие дедлайна с адресной видимостью ------------------


async def test_deadline_calendar_event_visibility(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    assignee = await make_user()
    outsider = await make_user()
    admin_h = await _headers(client, admin)
    assignee_h = await _headers(client, assignee)
    outsider_h = await _headers(client, outsider)

    deadline = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    task = await _create_task(
        client,
        admin_h,
        type="individual",
        title="WithDeadline",
        assignee_ids=[assignee.id],
        deadline_at=deadline,
    )

    def _task_event_ids(events: list[dict]) -> set[int]:
        return {e["id"] for e in events if e.get("task_id") == task["id"]}

    # Адресат и админ видят дедлайн-событие; посторонний — нет.
    assignee_events = (
        await client.get("/api/calendar/events", headers=assignee_h)
    ).json()
    admin_events = (await client.get("/api/calendar/events", headers=admin_h)).json()
    outsider_events = (
        await client.get("/api/calendar/events", headers=outsider_h)
    ).json()
    assert _task_event_ids(assignee_events)
    assert _task_event_ids(admin_events)
    assert not _task_event_ids(outsider_events)

    # Поштучно посторонний тоже получает 403.
    ev_id = next(iter(_task_event_ids(assignee_events)))
    assert (
        await client.get(f"/api/calendar/events/{ev_id}", headers=outsider_h)
    ).status_code == 403

    # Снятие дедлайна удаляет событие.
    await client.patch(
        f"/api/tasks/{task['id']}", headers=admin_h, json={"deadline_at": None}
    )
    after = (await client.get("/api/calendar/events", headers=assignee_h)).json()
    assert not _task_event_ids(after)


async def test_common_deadline_event_visible_to_all(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_h = await _headers(client, admin)
    member_h = await _headers(client, member)

    deadline = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    task = await _create_task(
        client, admin_h, type="common", title="CommonDL", deadline_at=deadline
    )
    events = (await client.get("/api/calendar/events", headers=member_h)).json()
    assert any(e.get("task_id") == task["id"] for e in events)


# --- доступ к медиа сдачи ----------------------------------------------------


async def test_submission_media_access(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    owner = await make_user()
    outsider = await make_user()
    admin_h = await _headers(client, admin)
    owner_h = await _headers(client, owner)
    outsider_h = await _headers(client, outsider)

    # individual: медиа сдачи доступно владельцу и админу, но не постороннему.
    indiv = await _create_task(
        client, admin_h, type="individual", title="M", assignee_ids=[owner.id]
    )
    asset = await _make_asset(session, owner.id)
    resp = await client.post(
        f"/api/tasks/{indiv['id']}/submissions",
        headers=owner_h,
        json={"body": "with file", "attachment_ids": [asset.id]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["attachments"], "attachments должны резолвиться"

    assert (
        await client.get(f"/api/media/{asset.id}", headers=owner_h)
    ).status_code == 200
    assert (
        await client.get(f"/api/media/{asset.id}", headers=admin_h)
    ).status_code == 200
    assert (
        await client.get(f"/api/media/{asset.id}", headers=outsider_h)
    ).status_code == 403

    # common: медиа сдачи доступно любому участнику.
    common = await _create_task(client, admin_h, type="common", title="CM")
    casset = await _make_asset(session, owner.id)
    await client.post(
        f"/api/tasks/{common['id']}/submissions",
        headers=owner_h,
        json={"attachment_ids": [casset.id]},
    )
    assert (
        await client.get(f"/api/media/{casset.id}", headers=outsider_h)
    ).status_code == 200


async def test_attach_foreign_asset_rejected(
    client: AsyncClient, session: AsyncSession, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    owner = await make_user()
    other = await make_user()
    admin_h = await _headers(client, admin)
    other_h = await _headers(client, other)

    common = await _create_task(client, admin_h, type="common", title="X")
    asset = await _make_asset(session, owner.id)  # принадлежит owner, не other
    resp = await client.post(
        f"/api/tasks/{common['id']}/submissions",
        headers=other_h,
        json={"body": "steal", "attachment_ids": [asset.id]},
    )
    assert resp.status_code == 404
