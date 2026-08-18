"""Тесты ручного зачёта дня админом (раздел Динамика) + защита эндпоинта."""
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.journal import JournalPardon

from .conftest import DEFAULT_INTAKE_OFFSET_DAYS, MakeUser, auth_headers, login


def _user_in(payload: dict, user_id: int) -> dict:
    return next(u for u in payload["users"] if u["user_id"] == user_id)


def _day_status(user: dict, day: date) -> str | None:
    for d in user["recent_days"]:
        if d["date"] == day.isoformat():
            return d["status"]
    return None


async def test_non_admin_cannot_credit(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.post(
        "/api/admin/dynamics/credit",
        headers=auth_headers(tokens["access_token"]),
        json={"user_id": user.id, "date": (date.today() - timedelta(days=1)).isoformat()},
    )
    assert resp.status_code == 403


async def test_admin_credit_and_uncredit_day(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    participant = await make_user(role="participant")
    admin_tokens = await login(client, admin.username, "adminpass123")

    # Берём вчера — прошедший день, гарантированно в пределах программы и окна отрисовки
    # (WINDOW_PAST=5): набор участника стартовал DEFAULT_INTAKE_OFFSET_DAYS дней назад.
    day = date.today() - timedelta(days=1)
    assert DEFAULT_INTAKE_OFFSET_DAYS > 1
    headers = auth_headers(admin_tokens["access_token"])

    # Зачесть день -> статус becomes 'credited', просрочка снимается.
    resp = await client.post(
        "/api/admin/dynamics/credit",
        headers=headers,
        json={"user_id": participant.id, "date": day.isoformat(), "credited": True},
    )
    assert resp.status_code == 200, resp.text
    u = _user_in(resp.json(), participant.id)
    assert _day_status(u, day) == "credited"

    # Идемпотентность: повторный зачёт не падает.
    resp2 = await client.post(
        "/api/admin/dynamics/credit",
        headers=headers,
        json={"user_id": participant.id, "date": day.isoformat(), "credited": True},
    )
    assert resp2.status_code == 200

    # Снять зачёт -> день снова 'missed' (записей журнала нет).
    resp3 = await client.post(
        "/api/admin/dynamics/credit",
        headers=headers,
        json={"user_id": participant.id, "date": day.isoformat(), "credited": False},
    )
    assert resp3.status_code == 200
    u3 = _user_in(resp3.json(), participant.id)
    assert _day_status(u3, day) == "missed"


async def test_credit_pardoned_day_refunds_whale(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    """Зачёт дня, на который потрачен кит, удаляет помилование — кит возвращается."""
    admin = await make_user(role="admin", password="adminpass123")
    participant = await make_user(role="participant")
    admin_tokens = await login(client, admin.username, "adminpass123")

    day = date.today() - timedelta(days=1)
    assert DEFAULT_INTAKE_OFFSET_DAYS > 1

    # Участник потратил кита на этот день.
    session.add(JournalPardon(user_id=participant.id, date=day))
    await session.commit()

    resp = await client.post(
        "/api/admin/dynamics/credit",
        headers=auth_headers(admin_tokens["access_token"]),
        json={"user_id": participant.id, "date": day.isoformat(), "credited": True},
    )
    assert resp.status_code == 200, resp.text
    u = _user_in(resp.json(), participant.id)
    # День теперь зачтён админом, а не помилован; помилований использовано — 0.
    assert _day_status(u, day) == "credited"
    assert u["pardons_used"] == 0

    # Помилование физически удалено — кит вернулся в пул.
    remaining_pardons = (
        await session.execute(
            select(JournalPardon.id).where(
                JournalPardon.user_id == participant.id, JournalPardon.date == day
            )
        )
    ).all()
    assert remaining_pardons == []


async def test_credit_future_day_rejected(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    participant = await make_user(role="participant")
    admin_tokens = await login(client, admin.username, "adminpass123")

    future = date.today() + timedelta(days=5)
    resp = await client.post(
        "/api/admin/dynamics/credit",
        headers=auth_headers(admin_tokens["access_token"]),
        json={"user_id": participant.id, "date": future.isoformat(), "credited": True},
    )
    assert resp.status_code == 400


async def test_window_follows_user_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Участники разных наборов в один календарный день видят разное окно.

    Регрессия на ARG-88: раньше начало 28-дневного окна было общим для всех
    (глобальная константа / самое раннее задание), и у набора с другой датой
    старта прогресс и просрочка считались не от его дня первого.
    """
    early_start = date.today() - timedelta(days=10)
    late_start = date.today() - timedelta(days=3)

    admin = await make_user(role="admin", password="adminpass123")
    early = await make_user(role="participant", intake_starts_on=early_start)
    late = await make_user(role="participant", intake_starts_on=late_start)

    # Личная динамика: окно начинается от даты набора участника, не от общей.
    for user, expected_start, expected_overdue in (
        (early, early_start, 10),
        (late, late_start, 3),
    ):
        tokens = await login(client, user.username, "initpass123")
        resp = await client.get(
            "/api/dynamics/my-stats", headers=auth_headers(tokens["access_token"])
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["program_start"] == expected_start.isoformat()
        # Записей в дневнике нет — просрочен каждый прошедший день окна.
        assert len(body["overdue_dates"]) == expected_overdue

    # Админ-обзор: та же разница в один и тот же календарный день.
    admin_tokens = await login(client, admin.username, "adminpass123")
    overview = await client.get(
        "/api/admin/dynamics", headers=auth_headers(admin_tokens["access_token"])
    )
    assert overview.status_code == 200, overview.text
    payload = overview.json()
    early_row = _user_in(payload, early.id)
    late_row = _user_in(payload, late.id)
    assert early_row["overdue_count"] == 10
    assert late_row["overdue_count"] == 3

    # День, попадающий в окно раннего набора и лежащий до старта позднего.
    between = date.today() - timedelta(days=4)
    assert _day_status(early_row, between) == "missed"
    assert _day_status(late_row, between) == "before_start"


async def test_admin_overview_filters_by_intake(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """`GET /api/admin/dynamics?intake_id=` отдаёт только участников набора.

    ARG-90: обзор был плоским списком по всем наборам сразу, из-за чего прогресс
    текущего набора нельзя было увидеть отдельно. Сводка обязана считаться по той
    же выборке, что и список, иначе счётчики врут про «своих».
    """
    early_start = date.today() - timedelta(days=10)
    late_start = date.today() - timedelta(days=3)

    admin = await make_user(role="admin", password="adminpass123")
    early = await make_user(role="participant", intake_starts_on=early_start)
    late = await make_user(role="participant", intake_starts_on=late_start)
    headers = auth_headers(
        (await login(client, admin.username, "adminpass123"))["access_token"]
    )

    # Без фильтра — оба участника, и у каждого проставлен свой набор.
    resp = await client.get("/api/admin/dynamics", headers=headers)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    ids = {u["user_id"] for u in payload["users"]}
    assert {early.id, late.id} <= ids
    assert _user_in(payload, early.id)["intake_id"] == early.intake_id
    assert _user_in(payload, late.id)["intake_id"] == late.intake_id

    # Фильтр по позднему набору: его участник есть, участник другого набора — нет.
    # Проверяем принадлежность, а не точный список: БД сюиты общая, и другие тесты
    # могли завести своих участников в набор с той же датой старта.
    resp = await client.get(
        f"/api/admin/dynamics?intake_id={late.intake_id}", headers=headers
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert {u["intake_id"] for u in payload["users"]} == {late.intake_id}
    ids = {u["user_id"] for u in payload["users"]}
    assert late.id in ids and early.id not in ids
    # Сводка считается по той же выборке, что и список (выпускники в неё не входят).
    ongoing = [u for u in payload["users"] if u["graduated_at"] is None]
    assert payload["summary"]["total_participants"] == len(ongoing)

    # Несколько наборов сразу — участники обоих в выдаче, посторонних наборов нет.
    resp = await client.get(
        f"/api/admin/dynamics?intake_id={late.intake_id}&intake_id={early.intake_id}",
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    ids = {u["user_id"] for u in payload["users"]}
    assert {early.id, late.id} <= ids
    assert {u["intake_id"] for u in payload["users"]} == {early.intake_id, late.intake_id}
