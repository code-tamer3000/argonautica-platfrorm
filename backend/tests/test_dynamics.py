"""Тесты ручного зачёта дня админом (раздел Динамика) + защита эндпоинта."""
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.journal import JournalPardon
from app.models.notification import Notification
from app.models.room import Room

from .conftest import MakeUser, auth_headers, login


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
        json={"user_id": user.id, "date": settings.journal_program_start.isoformat()},
    )
    assert resp.status_code == 403


async def test_admin_credit_and_uncredit_day(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    participant = await make_user(role="participant")
    admin_tokens = await login(client, admin.username, "adminpass123")

    # Берём вчера — прошедший день, гарантированно в пределах программы и окна отрисовки
    # (WINDOW_PAST=5). program_start в тестовой среде заведомо раньше вчера.
    day = date.today() - timedelta(days=1)
    assert settings.journal_program_start <= day
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
    assert settings.journal_program_start <= day

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


async def test_credit_clears_journal_missed_notification(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    participant = await make_user(role="participant")
    admin_tokens = await login(client, admin.username, "adminpass123")

    day = date.today() - timedelta(days=1)
    assert settings.journal_program_start <= day

    # Личный дневник участника (journal_missed ссылается на него через room_id).
    personal = Room(
        type="channel", name="journal", is_personal=True, created_by=participant.id
    )
    session.add(personal)
    await session.commit()
    await session.refresh(personal)

    # Уведомление «день не закрыт» уже висит у участника.
    notif = Notification(
        user_id=participant.id,
        kind="journal_missed",
        room_id=personal.id,
        ref_date=day,
    )
    session.add(notif)
    await session.commit()

    # Админ зачитывает этот день.
    resp = await client.post(
        "/api/admin/dynamics/credit",
        headers=auth_headers(admin_tokens["access_token"]),
        json={"user_id": participant.id, "date": day.isoformat(), "credited": True},
    )
    assert resp.status_code == 200, resp.text

    # Уведомление о несдаче должно быть удалено.
    remaining = (
        await session.execute(
            select(Notification.id).where(
                Notification.user_id == participant.id,
                Notification.kind == "journal_missed",
                Notification.ref_date == day,
            )
        )
    ).all()
    assert remaining == []


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
