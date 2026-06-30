"""Тесты профиля и директории (§4.2): правка своего профиля, аватар через media,
публичный профиль и список пользователей. Аватар-ассеты сидим через session (MinIO
не нужен — presigned-URL подписывается локально)."""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _image_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/avatar.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def test_update_basic_profile(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    user = await make_user()
    headers = await _headers(client, user)

    resp = await client.patch(
        "/api/auth/me",
        headers=headers,
        json={"display_name": "Новое Имя", "bio": "привет", "settings": {"theme": "dark"}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_name"] == "Новое Имя"
    assert body["bio"] == "привет"
    assert body["settings"] == {"theme": "dark"}

    me = await client.get("/api/auth/me", headers=headers)
    assert me.json()["display_name"] == "Новое Имя"


async def test_set_and_clear_avatar_via_media(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    user = await make_user()
    asset = await _image_asset(session, user.id)
    headers = await _headers(client, user)

    resp = await client.patch(
        "/api/auth/me", headers=headers, json={"avatar_media_id": asset.id}
    )
    assert resp.status_code == 200
    assert resp.json()["avatar_url"] and resp.json()["avatar_url"].startswith("http")

    # Публичный профиль тоже отдаёт подписанный аватар.
    pub = await client.get(f"/api/users/{user.id}", headers=headers)
    assert pub.json()["avatar_url"] and pub.json()["avatar_url"].startswith("http")

    # Снятие аватара (null) → avatar_url возвращается к None.
    cleared = await client.patch(
        "/api/auth/me", headers=headers, json={"avatar_media_id": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["avatar_url"] is None


async def test_cannot_use_others_asset(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    other = await make_user()
    asset = await _image_asset(session, other.id)  # принадлежит other

    resp = await client.patch(
        "/api/auth/me",
        headers=await _headers(client, owner),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 403


async def test_avatar_must_be_image(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    user = await make_user()
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/doc.pdf",
        kind="file",
        mime_type="application/pdf",
        size=10,
        created_by=user.id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)

    resp = await client.patch(
        "/api/auth/me",
        headers=await _headers(client, user),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 404


async def test_directory_and_public_profile(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    u1 = await make_user()
    u2 = await make_user()
    headers = await _headers(client, u1)

    listing = await client.get("/api/users", headers=headers)
    assert listing.status_code == 200
    ids = {u["id"] for u in listing.json()}
    assert {u1.id, u2.id} <= ids

    one = await client.get(f"/api/users/{u2.id}", headers=headers)
    assert one.status_code == 200
    body = one.json()
    assert body["username"] == u2.username
    assert "email" not in body  # публичный профиль не светит email/settings
    assert "settings" not in body

    missing = await client.get("/api/users/999999", headers=headers)
    assert missing.status_code == 404


async def test_profile_extra_field_forbidden(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    user = await make_user()
    resp = await client.patch(
        "/api/auth/me",
        headers=await _headers(client, user),
        json={"role": "admin"},  # не whitelisted — extra="forbid"
    )
    assert resp.status_code == 422
