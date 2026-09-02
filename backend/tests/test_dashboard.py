"""Стартовый экран: один агрегат вместо семи запросов на первом рендере.

Каждое поле уже покрыто своими эндпоинтами (dynamics/tasks/calendar/notifications) —
здесь проверяется только сборка: состав ответа для участника, 403 наблюдателю,
усечённый ответ для админа, флаг `journal_locked` у выпускника/закрытого окна.
"""
from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expedition import IntakeStage
from app.models.user import User
from app.services.rooms import ensure_news_channel

from .conftest import MakeUser, auth_headers, get_or_create_intake, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _seed_stages(session: AsyncSession, intake_id: int, start: date) -> None:
    # Тестовая БД переживает прогоны и наборы переиспользуются по starts_on — без
    # очистки два теста на одной относительной дате столкнутся на UNIQUE.
    await session.execute(delete(IntakeStage).where(IntakeStage.intake_id == intake_id))
    kinds = ("balance", "air", "fire", "water", "earth", "final")
    offsets = (0, 4, 10, 16, 21, 27)
    for kind, off in zip(kinds, offsets, strict=True):
        session.add(
            IntakeStage(intake_id=intake_id, kind=kind, air_date=start + timedelta(days=off))
        )
    await session.commit()


async def test_participant_dashboard_shape(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    start = date.today() - timedelta(days=12)
    intake = await get_or_create_intake(session, start)
    user = await make_user(intake_id=intake.id)
    await _seed_stages(session, intake.id, start)
    headers = await _headers(client, user)

    resp = await client.get("/api/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["expedition"] is not None
    assert body["expedition"]["total_days"] == 28
    assert body["expedition"]["today"] == 13  # день 13 = старт+12
    assert len(body["expedition"]["days"]) == 28
    assert set(body["expedition"]["lock_states"].keys()) == {"air", "fire", "water", "earth"}
    assert body["expedition"]["lock_states"]["earth"] == "locked"  # этап ещё не наступил

    assert body["journal"] is not None  # сид «Программа дневника»
    assert body["journal_locked"] is False
    assert isinstance(body["upcoming_events"], list)
    assert isinstance(body["active_tasks"], list)
    assert isinstance(body["notifications"], list)
    assert isinstance(body["unread_notifications"], int)


async def test_observer_has_no_dashboard(client: AsyncClient, make_user: MakeUser) -> None:
    observer = await make_user(is_observer=True)
    headers = await _headers(client, observer)
    resp = await client.get("/api/dashboard", headers=headers)
    assert resp.status_code == 403, resp.text


async def test_admin_dashboard_has_no_personal_layer(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Админ видит круг потока (если расписание есть), но не свою Динамику/задачи —
    у него их не бывает."""
    start = date.today() - timedelta(days=1)
    intake = await get_or_create_intake(session, start)
    admin = await make_user(role="admin", intake_id=intake.id)
    await _seed_stages(session, intake.id, start)
    headers = await _headers(client, admin)

    resp = await client.get("/api/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["expedition"] is not None
    assert body["journal"] is None
    assert body["journal_locked"] is False
    assert body["active_tasks"] == []


async def test_dashboard_without_stages_falls_back_to_equal_quarters(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    intake = await get_or_create_intake(session, date.today() - timedelta(days=1))
    # Набор мог переиспользоваться другим тестом на той же относительной дате
    # (тестовая БД не откатывается между тестами) — гарантируем пустое расписание.
    await session.execute(delete(IntakeStage).where(IntakeStage.intake_id == intake.id))
    await session.commit()
    user = await make_user(intake_id=intake.id)
    headers = await _headers(client, user)

    resp = await client.get("/api/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    expedition = resp.json()["expedition"]
    assert expedition is not None
    assert expedition["total_days"] == 28
    assert [s["kind"] for s in expedition["stages"]] == ["air", "fire", "water", "earth"]


async def test_dashboard_journal_locked_for_graduate(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    start = date.today() - timedelta(days=30)
    intake = await get_or_create_intake(session, start)
    user = await make_user(
        intake_id=intake.id, graduated_at=datetime.now(UTC) - timedelta(days=1)
    )
    headers = await _headers(client, user)

    resp = await client.get("/api/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["journal_locked"] is True


async def test_dashboard_journal_locked_for_closed_intake_window(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    start = date.today() - timedelta(days=40)
    ends_on = date.today() - timedelta(days=1)
    intake = await get_or_create_intake(session, start, ends_on)
    user = await make_user(intake_id=intake.id)
    headers = await _headers(client, user)

    resp = await client.get("/api/dashboard", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["journal_locked"] is True


async def test_lock_state_reveals_after_stage_task_accepted(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Проводка через реальный жизненный цикл задачи: назначение — сдача — приём
    admin'ом раскрывает замок стихии (не только юнит-тест lock_state)."""
    yesterday = date.today() - timedelta(days=1)
    intake = await get_or_create_intake(session, date.today() - timedelta(days=2))
    admin = await make_user(role="admin")
    user = await make_user(intake_id=intake.id)

    admin_headers_ = await _headers(client, admin)
    task_resp = await client.post(
        "/api/tasks",
        headers=admin_headers_,
        json={"type": "individual", "title": "Раскрой Воздух", "assignee_ids": [user.id]},
    )
    assert task_resp.status_code == 201, task_resp.text
    task_id = task_resp.json()["id"]

    await session.execute(delete(IntakeStage).where(IntakeStage.intake_id == intake.id))
    session.add(IntakeStage(intake_id=intake.id, kind="air", air_date=yesterday, task_id=task_id))
    await session.commit()

    user_headers = await _headers(client, user)
    before = await client.get("/api/dashboard", headers=user_headers)
    assert before.json()["expedition"]["lock_states"]["air"] == "unlockable"

    lock_resp = await client.put(
        "/api/expedition/locks/air", headers=user_headers, json={"key_number": 3}
    )
    assert lock_resp.status_code == 200, lock_resp.text
    entered = await client.get("/api/dashboard", headers=user_headers)
    assert entered.json()["expedition"]["lock_states"]["air"] == "entered"

    await client.post(
        f"/api/tasks/{task_id}/submissions", headers=user_headers, json={"body": "готово"}
    )
    tracks = (
        await client.get(f"/api/tasks/{task_id}/submissions", headers=admin_headers_)
    ).json()
    assignment_id = tracks[0]["assignment_id"]
    accept = await client.post(
        f"/api/tasks/assignments/{assignment_id}/review",
        headers=admin_headers_,
        json={"action": "accept"},
    )
    assert accept.status_code == 200, accept.text

    revealed = await client.get("/api/dashboard", headers=user_headers)
    assert revealed.json()["expedition"]["lock_states"]["air"] == "revealed"


async def test_news_preview_strips_inline_formatting_marks(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Превью новости на дашборде — обычный текст: маркеры **/*/++ панели
    форматирования (frontend/src/features/chat/useTextFormatting.tsx) не рендерятся
    на дашборде, значит не должны утекать в превью как сырые символы.

    Свой набор (intake_starts_on) — иначе с дефолтным набором (DEFAULT_INTAKE_OFFSET_DAYS)
    новостной канал общий с другими тестами (test_notifications.py, test_observer.py
    переиспользуют его по стартовой дате), и "последнее сообщение" оказалось бы
    недетерминированным."""
    start = date.today() - timedelta(days=17)
    intake = await get_or_create_intake(session, start)
    admin = await make_user(role="admin", intake_id=intake.id)
    participant = await make_user(intake_id=intake.id)

    news = await ensure_news_channel(session, intake.id)
    await session.commit()

    send_resp = await client.post(
        f"/api/rooms/{news.id}/messages",
        headers=await _headers(client, admin),
        json={"content": "**жирный** и *курсив* и ++подчёркнутый++ пост"},
    )
    assert send_resp.status_code == 201, send_resp.text

    resp = await client.get("/api/dashboard", headers=await _headers(client, participant))
    assert resp.status_code == 200, resp.text
    news_preview = resp.json()["news_preview"]
    assert news_preview is not None
    assert news_preview["preview"] == "жирный и курсив и подчёркнутый пост"
