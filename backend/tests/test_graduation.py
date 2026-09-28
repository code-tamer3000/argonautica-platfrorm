"""Экспедиция пройдена (users.graduated_at): что остаётся выпускнику.

Флаг ставит отправка выпускной анкеты. После него: Динамика закрыта (403), в
Задачах видны сданные задачи плюс те, что ещё можно доздать (ARG-157 —
assigned/returned на момент выпуска), Рубка целиком «только чтение» — история
читается, писать нельзя. См. docs/SURVEY.md, docs/TASKS.md, app/services/graduation.py.
"""
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.plan import Plan
from app.models.survey import SurveyResponse
from app.models.user import User
from app.services.graduation import GRADUATED_MESSAGE
from app.services.survey_form import SURVEY_QUESTIONS

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


def _valid_answers() -> dict[str, dict[str, object]]:
    """Минимально валидные ответы по канону: длинный текст / первый вариант."""
    answers: dict[str, dict[str, object]] = {}
    for q in SURVEY_QUESTIONS:
        if q.kind == "multi":
            answers[q.key] = {"choices": [q.options[0].key], "comment": "Так вышло." * 5}
        else:
            answers[q.key] = {"text": "Экспедиция изменила меня. " * 20}
    return answers


async def _create_task(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/tasks", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


# --- отметка выпуска --------------------------------------------------------


async def test_survey_submit_marks_graduated(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    user = await make_user()
    user.survey_required = True
    await session.commit()

    resp = await client.post(
        "/api/survey",
        headers=await _headers(client, user),
        json={"answers": _valid_answers(), "publish_consent": False},
    )
    assert resp.status_code == 201, resp.text

    await session.refresh(user)
    assert user.survey_required is False
    assert user.graduated_at is not None

    me = await client.get("/api/auth/me", headers=await _headers(client, user))
    assert me.json()["graduated_at"] is not None


async def test_submitted_before_release_gets_graduated_on_retry(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Анкета сдана, а отметки нет (данные до релиза) — повторная попытка чинит её."""
    user = await make_user()
    user.survey_required = True
    session.add(
        SurveyResponse(user_id=user.id, version=1, answers={}, publish_consent=False)
    )
    await session.commit()

    resp = await client.post(
        "/api/survey",
        headers=await _headers(client, user),
        json={"answers": _valid_answers(), "publish_consent": False},
    )
    assert resp.status_code == 409, resp.text

    await session.refresh(user)
    assert user.survey_required is False
    assert user.graduated_at is not None

    stored = (
        await session.execute(
            select(SurveyResponse).where(SurveyResponse.user_id == user.id)
        )
    ).scalar_one()
    assert user.graduated_at == stored.created_at  # берём дату самой сдачи


async def test_survey_submit_notifies_admins_and_bursts(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Сдача анкеты уведомляет всех админов; вторая сдача, пока уведомление не
    прочитано, схлопывается в ту же строку (group_count), а не плодит вторую."""
    admin = await make_user(role="admin")
    first = await make_user()
    second = await make_user()

    resp = await client.post(
        "/api/survey",
        headers=await _headers(client, first),
        json={"answers": _valid_answers(), "publish_consent": False},
    )
    assert resp.status_code == 201, resp.text

    row = (
        await session.execute(
            select(Notification).where(
                Notification.user_id == admin.id,
                Notification.kind == "survey_submitted",
            )
        )
    ).scalar_one()
    assert row.group_count == 1
    assert row.read_at is None

    resp = await client.post(
        "/api/survey",
        headers=await _headers(client, second),
        json={"answers": _valid_answers(), "publish_consent": False},
    )
    assert resp.status_code == 201, resp.text

    rows = (
        (
            await session.execute(
                select(Notification).where(
                    Notification.user_id == admin.id,
                    Notification.kind == "survey_submitted",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1  # схлопнулось в ту же строку, не завело вторую
    assert rows[0].group_count == 2


async def test_unknown_answer_key_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Вопрос удалён из канона (v1 -> v2, openness/rhythm_breaks) — старый ключ
    в ответе больше не принимается, а не тихо игнорируется."""
    user = await make_user()
    user.survey_required = True

    answers = _valid_answers()
    answers["openness"] = {"text": "Старый вопрос из v1."}

    resp = await client.post(
        "/api/survey",
        headers=await _headers(client, user),
        json={"answers": answers, "publish_consent": False},
    )
    assert resp.status_code == 422, resp.text


async def test_admin_survey_overview_includes_plan_and_intake(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """GET /api/admin/survey денормализует тариф/поток на строку (ARG survey revamp)."""
    plan = Plan(name="Тестовый тариф", price=9000, description="", is_active=True)
    session.add(plan)
    await session.commit()

    admin = await make_user(role="admin")
    participant = await make_user(plan_id=plan.id)
    await session.commit()

    headers = await _headers(client, admin)
    resp = await client.get("/api/admin/survey", headers=headers)
    assert resp.status_code == 200, resp.text

    row = next(r for r in resp.json()["rows"] if r["user_id"] == participant.id)
    assert row["plan_id"] == plan.id
    assert row["plan_name"] == "Тестовый тариф"
    assert row["intake_id"] == participant.intake_id
    assert row["intake_starts_on"] is not None


# --- Динамика ----------------------------------------------------------------


async def test_graduate_has_no_dynamics(
    client: AsyncClient, make_user: MakeUser
) -> None:
    graduate = await make_user(graduated_at=datetime.now(UTC))
    headers = await _headers(client, graduate)

    for path in ("/api/dynamics/my-stats", "/api/dynamics/structure"):
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 403, (path, resp.text)

    pardon = await client.post(
        "/api/dynamics/pardon", headers=headers, json={"date": "2026-07-05"}
    )
    assert pardon.status_code == 403, pardon.text


async def test_admin_still_sees_graduate_in_dynamics(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    graduate = await make_user(graduated_at=datetime.now(UTC))

    resp = await client.get("/api/admin/dynamics", headers=await _headers(client, admin))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    row = next(u for u in body["users"] if u["user_id"] == graduate.id)
    assert row["graduated_at"] is not None  # отметка «закончил экспедицию»
    # В сводку выпускник не входит — она про тех, кто ещё в пути.
    assert body["summary"]["total_participants"] == sum(
        1 for u in body["users"] if u["graduated_at"] is None
    )


# --- Задачи ------------------------------------------------------------------


async def test_graduate_sees_submitted_and_backfillable_tasks(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-157: assigned/returned остаются видимы (дозадача), untouched common — нет."""
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    submitted = await _create_task(
        client, admin_h, type="individual", title="Сдана", assignee_ids=[user.id]
    )
    assigned = await _create_task(
        client, admin_h, type="individual", title="Ещё не сдана", assignee_ids=[user.id]
    )
    untouched_common = await _create_task(client, admin_h, type="common", title="Общая")

    resp = await client.post(
        f"/api/tasks/{submitted['id']}/submissions", headers=user_h, json={"body": "готово"}
    )
    assert resp.status_code == 201, resp.text

    # До выпуска видны все три.
    ids_before = {t["id"] for t in (await client.get("/api/tasks", headers=user_h)).json()["items"]}
    assert {submitted["id"], assigned["id"], untouched_common["id"]} <= ids_before

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    listed = (await client.get("/api/tasks", headers=user_h)).json()
    ids_after = {t["id"] for t in listed["items"]}
    assert submitted["id"] in ids_after
    assert assigned["id"] in ids_after  # ещё не сдана, но назначена — можно доздать
    assert untouched_common["id"] not in ids_after  # никогда не открывал — остаётся закрыта

    # Прямая ссылка: на сдаваемую и на дозадаваемую — 200, на никогда не открытую — 403.
    assert (
        await client.get(f"/api/tasks/{submitted['id']}", headers=user_h)
    ).status_code == 200
    assert (
        await client.get(f"/api/tasks/{assigned['id']}", headers=user_h)
    ).status_code == 200
    assert (
        await client.get(f"/api/tasks/{untouched_common['id']}", headers=user_h)
    ).status_code == 403


async def test_graduate_cannot_resubmit_or_comment_already_submitted(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Задание, уже сданное ДО выпуска, — тупик как и раньше: не пересдать, не прокомментировать."""
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    task = await _create_task(
        client, admin_h, type="individual", title="Т", assignee_ids=[user.id]
    )
    first = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "раз"}
    )
    assert first.status_code == 201, first.text
    submission_id = first.json()["id"]

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    again = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "два"}
    )
    assert again.status_code == 403
    assert again.json()["detail"] == GRADUATED_MESSAGE

    comment = await client.post(
        f"/api/tasks/submissions/{submission_id}/comments",
        headers=user_h,
        json={"body": "ещё мысль"},
    )
    assert comment.status_code == 403


async def test_graduate_can_backfill_assigned_task(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-157: задание, назначенное, но не сданное к моменту выпуска, можно доздать."""
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    task = await _create_task(
        client, admin_h, type="individual", title="Не успел", assignee_ids=[user.id]
    )

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    resp = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "доздал"}
    )
    assert resp.status_code == 201, resp.text

    # Один раз доздал — задание ушло в 'submitted', дальше снова закрыто (и сдача,
    # и комментарий — комментировать уже сданное выпускник по-прежнему не может).
    again = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "ещё раз"}
    )
    assert again.status_code == 403
    assert again.json()["detail"] == GRADUATED_MESSAGE

    comment = await client.post(
        f"/api/tasks/submissions/{resp.json()['id']}/comments",
        headers=user_h,
        json={"body": "уточнение"},
    )
    assert comment.status_code == 403


async def test_graduate_can_backfill_returned_task(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-157: задание, вернутое на доработку и не пересданное к выпуску, тоже дозадаётся —
    и пока оно ещё 'returned' (до пересдачи), по нему можно и прокомментировать."""
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    task = await _create_task(
        client, admin_h, type="individual", title="Вернули", assignee_ids=[user.id]
    )
    first = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "черновик"}
    )
    assert first.status_code == 201, first.text
    assignment_id = first.json()["assignment_id"]
    first_submission_id = first.json()["id"]

    returned = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "return", "comment": "доработай"},
    )
    assert returned.status_code == 200, returned.text

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    # Ещё 'returned' — комментарий на старую сдачу разрешён (уточнить, что доработать).
    comment = await client.post(
        f"/api/tasks/submissions/{first_submission_id}/comments",
        headers=user_h,
        json={"body": "уточнение"},
    )
    assert comment.status_code == 201, comment.text

    resp = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "доработал"}
    )
    assert resp.status_code == 201, resp.text


async def test_graduate_can_open_required_task_never_assigned(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-159 x ARG-157: задача, отмеченная required_for_graduation, которую
    участник ни разу не открывал до выпуска, не имеет строки task_assignments —
    ARG-157 закрывал такую задачу для выпускника наглухо (только уже назначенные),
    но гейт по артефакту ссылается именно на неё. Раньше переход по этой ссылке
    отвечал 403 — задача, которая должна была открыться, оставалась недоступной."""
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)

    task = await _create_task(
        client, admin_h, type="common", title="Обязательное для артефакта"
    )
    patched = await client.patch(
        f"/api/tasks/{task['id']}",
        headers=admin_h,
        json={"required_for_graduation": True},
    )
    assert patched.status_code == 200, patched.text

    user.survey_required = True
    await session.commit()
    submit = await client.post(
        "/api/survey",
        headers=await _headers(client, user),
        json={"answers": _valid_answers(), "publish_consent": False},
    )
    assert submit.status_code == 201, submit.text

    response = (
        await session.execute(select(SurveyResponse).where(SurveyResponse.user_id == user.id))
    ).scalar_one()
    assert task["id"] in response.required_task_ids

    user_h = await _headers(client, user)
    # Карточка задачи открывается, хотя task_assignments для этой пары пуст.
    detail = await client.get(f"/api/tasks/{task['id']}", headers=user_h)
    assert detail.status_code == 200, detail.text

    listing = await client.get("/api/tasks", headers=user_h)
    assert task["id"] in {t["id"] for t in listing.json()["items"]}

    # И доздать её тоже можно — get_or_create_assignment заводит назначение лениво.
    submitted = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "доздал"}
    )
    assert submitted.status_code == 201, submitted.text


async def test_admin_survey_shows_which_required_task_is_pending(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """ARG-162: `GET /api/admin/survey` называет админу конкретную недосданную
    обязательную задачу выпускника, а не только факт «гейт закрыт»."""
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    user = await make_user()

    task = await _create_task(
        client, admin_h, type="common", title="Обязательная для гейта"
    )
    patched = await client.patch(
        f"/api/tasks/{task['id']}",
        headers=admin_h,
        json={"required_for_graduation": True},
    )
    assert patched.status_code == 200, patched.text

    user.survey_required = True
    await session.commit()
    submit = await client.post(
        "/api/survey",
        headers=await _headers(client, user),
        json={"answers": _valid_answers(), "publish_consent": False},
    )
    assert submit.status_code == 201, submit.text

    overview = (await client.get("/api/admin/survey", headers=admin_h)).json()
    row = next(r for r in overview["rows"] if r["user_id"] == user.id)
    assert row["mandatory_total"] is not None and row["mandatory_total"] >= 1
    pending_ids = {t["id"] for t in row["mandatory_pending"]}
    assert task["id"] in pending_ids
    assert any(t["title"] == "Обязательная для гейта" for t in row["mandatory_pending"])

    user_h = await _headers(client, user)
    sub = await client.post(
        f"/api/tasks/{task['id']}/submissions", headers=user_h, json={"body": "готово"}
    )
    assert sub.status_code == 201, sub.text
    assignment_id = sub.json()["assignment_id"]
    accept = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_h,
        json={"action": "accept"},
    )
    assert accept.status_code == 200, accept.text

    overview = (await client.get("/api/admin/survey", headers=admin_h)).json()
    row = next(r for r in overview["rows"] if r["user_id"] == user.id)
    pending_ids = {t["id"] for t in row["mandatory_pending"]}
    assert task["id"] not in pending_ids


async def test_admin_survey_mandatory_total_null_before_submit(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin")
    admin_h = await _headers(client, admin)
    user = await make_user()

    overview = (await client.get("/api/admin/survey", headers=admin_h)).json()
    row = next(r for r in overview["rows"] if r["user_id"] == user.id)
    assert row["mandatory_total"] is None
    assert row["mandatory_pending"] == []


# --- Рубка -------------------------------------------------------------------


@pytest.mark.parametrize("room_type", ["dm", "group"])
async def test_graduate_reads_history_but_cannot_write(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
    room_type: str,
) -> None:
    peer = await make_user()
    user = await make_user()
    room = await make_room(created_by=peer.id, type=room_type)
    await add_membership(room.id, peer.id, "owner")
    await add_membership(room.id, user.id)
    user_h = await _headers(client, user)

    mine = await client.post(
        f"/api/rooms/{room.id}/messages", headers=user_h, json={"content": "до выпуска"}
    )
    assert mine.status_code == 201, mine.text
    message_id = mine.json()["id"]

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    # История на месте.
    feed = await client.get(f"/api/rooms/{room.id}/messages", headers=user_h)
    assert feed.status_code == 200, feed.text
    assert any(m["id"] == message_id for m in feed.json())
    assert (await client.get("/api/rooms", headers=user_h)).status_code == 200

    # Писать/править/удалять — нельзя.
    send = await client.post(
        f"/api/rooms/{room.id}/messages", headers=user_h, json={"content": "после"}
    )
    assert send.status_code == 403
    assert send.json()["detail"] == GRADUATED_MESSAGE
    assert (
        await client.patch(
            f"/api/rooms/{room.id}/messages/{message_id}",
            headers=user_h,
            json={"content": "правка"},
        )
    ).status_code == 403
    assert (
        await client.delete(
            f"/api/rooms/{room.id}/messages/{message_id}", headers=user_h
        )
    ).status_code == 403


async def test_graduate_cannot_write_in_own_journal(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Личный дневник — тот же барьер: записи прошлого читаются, новых нет."""
    user = await make_user()
    room = await make_room(created_by=user.id, type="channel", name="Личный дневник")
    room.is_personal = True
    await session.commit()
    await add_membership(room.id, user.id, "owner")
    user_h = await _headers(client, user)

    entry = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=user_h,
        json={"content": "<!--journal:focus-->Фокус дня"},
    )
    assert entry.status_code == 201, entry.text

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    feed = await client.get(f"/api/rooms/{room.id}/messages", headers=user_h)
    assert feed.status_code == 200
    assert len(feed.json()) == 1

    blocked = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=user_h,
        json={"content": "<!--journal:focus-->Ещё запись"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == GRADUATED_MESSAGE
