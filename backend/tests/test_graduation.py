"""Экспедиция пройдена (users.graduated_at): что остаётся выпускнику.

Флаг ставит отправка выпускной анкеты. После него: Динамика закрыта (403), в
Задачах видны только сданные задачи, Рубка целиком «только чтение» — история
читается, писать нельзя. См. docs/SURVEY.md, app/services/graduation.py.
"""
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


async def test_graduate_sees_only_submitted_tasks(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin")
    user = await make_user()
    admin_h = await _headers(client, admin)
    user_h = await _headers(client, user)

    submitted = await _create_task(
        client, admin_h, type="individual", title="Сдана", assignee_ids=[user.id]
    )
    untouched = await _create_task(
        client, admin_h, type="individual", title="Не начата", assignee_ids=[user.id]
    )
    common = await _create_task(client, admin_h, type="common", title="Общая")

    resp = await client.post(
        f"/api/tasks/{submitted['id']}/submissions", headers=user_h, json={"body": "готово"}
    )
    assert resp.status_code == 201, resp.text

    # До выпуска видны все три.
    ids_before = {t["id"] for t in (await client.get("/api/tasks", headers=user_h)).json()["items"]}
    assert {submitted["id"], untouched["id"], common["id"]} <= ids_before

    user.graduated_at = datetime.now(UTC)
    await session.commit()

    listed = (await client.get("/api/tasks", headers=user_h)).json()
    ids_after = {t["id"] for t in listed["items"]}
    assert submitted["id"] in ids_after
    assert untouched["id"] not in ids_after
    assert common["id"] not in ids_after
    # Бейдж пуст, прогресс считается по сданным.
    assert listed["attention_count"] == 0
    assert listed["progress"]["total"] == len(listed["items"])

    # Прямая ссылка на невидимую задачу — 403, на свою сданную — 200.
    assert (
        await client.get(f"/api/tasks/{untouched['id']}", headers=user_h)
    ).status_code == 403
    assert (
        await client.get(f"/api/tasks/{submitted['id']}", headers=user_h)
    ).status_code == 200


async def test_graduate_cannot_submit_or_comment(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
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
