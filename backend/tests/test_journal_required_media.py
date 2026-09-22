"""Обязательное фото/видео к разделу дневника (ARG-140).

journal_programs — глобальная шкала на всю тестовую БД (см. test_journal_structure.py),
поэтому:
- запрос к БД (`section_requires_media`) тестируем на самодельном задании с датой
  старта В БУДУЩЕМ, передавая эту же дату явно как `day` — «сегодня» платформы не трогаем;
- гейт в `send_message` смотрит на задание, активное СЕГОДНЯ (`platform_today()`), поэтому
  на время теста подменяем `platform_today` в `app.api.messages`, чтобы «сегодня» совпало
  с датой старта тестового задания — без этого пришлось бы менять реальную активную
  структуру и ломать остальные тесты, гоняющиеся по той же БД.
"""
from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.api.messages as messages_mod
from app.api.dynamics import _platform_today, section_requires_media
from app.models.media import MediaAsset

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


def _future_date(offset_days: int):
    return _platform_today() + timedelta(days=3650 + offset_days)


async def _headers(client: AsyncClient, username: str, password: str) -> dict[str, str]:
    tokens = await login(client, username, password)
    return auth_headers(tokens["access_token"])


# ─── section_requires_media (прямой запрос к БД) ────────────────────────────

async def test_section_requires_media_reads_active_program(
    client: AsyncClient, make_user: MakeUser, session: AsyncSession
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    headers = await _headers(client, admin.username, "adminpass123")
    starts_on = _future_date(200)

    created = await client.post(
        "/api/admin/journal/programs",
        headers=headers,
        json={
            "starts_on": starts_on.isoformat(),
            "title": None,
            "description": None,
            "sections": [
                {"key": "photo", "label": "Фото дня", "requires_media": True},
                {"key": "notes", "label": "Заметки", "requires_media": False},
            ],
        },
    )
    assert created.status_code == 201, created.text
    program_id = created.json()["id"]
    assert created.json()["sections"][0]["requires_media"] is True
    assert created.json()["sections"][1]["requires_media"] is False

    try:
        assert await section_requires_media(session, "photo", starts_on) is True
        assert await section_requires_media(session, "notes", starts_on) is False
        # Ключ, которого нет ни в одном разделе активного задания.
        assert await section_requires_media(session, "does_not_exist", starts_on) is False
        # До даты старта этого задания оно ещё не активно (сид-задание — без этого ключа).
        assert await section_requires_media(session, "photo", starts_on - timedelta(days=1)) is False
    finally:
        deleted = await client.delete(
            f"/api/admin/journal/programs/{program_id}", headers=headers
        )
        assert deleted.status_code == 204


# ─── Гейт на отправке сообщения ──────────────────────────────────────────────

async def test_send_rejects_required_section_without_media(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
    monkeypatch,
) -> None:
    owner = await make_user(role="participant", password="initpass123")
    room = await make_room(created_by=owner.id, type="channel", name="Личный дневник")
    room.is_personal = True
    await add_membership(room.id, owner.id, "owner")
    await session.commit()
    headers = await _headers(client, owner.username, "initpass123")

    admin = await make_user(role="admin", password="adminpass123")
    admin_headers = await _headers(client, admin.username, "adminpass123")
    starts_on = _future_date(201)
    created = await client.post(
        "/api/admin/journal/programs",
        headers=admin_headers,
        json={
            "starts_on": starts_on.isoformat(),
            "title": None,
            "description": None,
            "sections": [{"key": "photo", "label": "Фото дня", "requires_media": True}],
        },
    )
    assert created.status_code == 201, created.text
    program_id = created.json()["id"]
    monkeypatch.setattr(messages_mod, "platform_today", lambda: starts_on)

    try:
        # Без вложения — 422, сообщение не создаётся.
        rejected = await client.post(
            f"/api/rooms/{room.id}/messages",
            headers=headers,
            json={"content": "<!--journal:photo-->## 🎯 Фото дня\nтекст без фото"},
        )
        assert rejected.status_code == 422, rejected.text

        # С файлом (не image/video) — тоже 422.
        file_asset = MediaAsset(
            bucket="chat-media", storage_key="2026/06/x.pdf", kind="file",
            mime_type="application/pdf", size=10, created_by=owner.id,
        )
        session.add(file_asset)
        await session.commit()
        rejected2 = await client.post(
            f"/api/rooms/{room.id}/messages",
            headers=headers,
            json={
                "content": "<!--journal:photo-->## 🎯 Фото дня\nтекст",
                "attachment_ids": [file_asset.id],
            },
        )
        assert rejected2.status_code == 422, rejected2.text

        # С фото — проходит.
        image_asset = MediaAsset(
            bucket="chat-media", storage_key="2026/06/x.jpg", kind="image",
            mime_type="image/jpeg", size=10, created_by=owner.id,
        )
        session.add(image_asset)
        await session.commit()
        ok = await client.post(
            f"/api/rooms/{room.id}/messages",
            headers=headers,
            json={
                "content": "<!--journal:photo-->## 🎯 Фото дня\nтекст",
                "attachment_ids": [image_asset.id],
            },
        )
        assert ok.status_code == 201, ok.text

        # Обычное сообщение (без маркера) в той же комнате не гейтится вообще.
        plain = await client.post(
            f"/api/rooms/{room.id}/messages",
            headers=headers,
            json={"content": "просто сообщение"},
        )
        assert plain.status_code == 201, plain.text
    finally:
        deleted = await client.delete(
            f"/api/admin/journal/programs/{program_id}", headers=admin_headers
        )
        assert deleted.status_code == 204


async def test_send_ok_without_media_when_section_does_not_require_it(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """Регрессия: раздел без флага (как сид-задание) отправляется текстом, как раньше."""
    owner = await make_user(role="participant", password="initpass123")
    room = await make_room(created_by=owner.id, type="channel", name="Личный дневник")
    room.is_personal = True
    await add_membership(room.id, owner.id, "owner")
    await session.commit()
    headers = await _headers(client, owner.username, "initpass123")

    ok = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=headers,
        json={"content": "<!--journal:focus-->## 🎯 Фокус на день\nтекст без вложений"},
    )
    assert ok.status_code == 201, ok.text
