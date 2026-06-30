"""Тесты стикерпаков (§4.5): admin создаёт паки/стикеры (картинка — media-ассет),
участники читают; интеграция с отправкой стикер-сообщения. Image-ассеты сидим через
session (MinIO не нужен — presigned-URL подписывается локально)."""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.user import User

from .conftest import (
    AddMembership,
    MakeRoom,
    MakeUser,
    auth_headers,
    login,
)


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _image_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/sticker.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def _create_pack(client: AsyncClient, headers: dict[str, str], name: str) -> dict:
    resp = await client.post("/api/stickerpacks", headers=headers, json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_admin_creates_pack_and_sticker(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_headers = await _headers(client, admin)

    pack = await _create_pack(client, admin_headers, "Котики")
    asset = await _image_asset(session, admin.id)

    added = await client.post(
        f"/api/stickerpacks/{pack['id']}/stickers",
        headers=admin_headers,
        json={"image_media_id": asset.id, "keyword": "cat"},
    )
    assert added.status_code == 201, added.text
    assert added.json()["image_url"].startswith("http")  # подписанный media-URL

    # Участник видит пак со стикером и подписанной картинкой.
    listing = await client.get("/api/stickerpacks", headers=await _headers(client, member))
    assert listing.status_code == 200
    packs = {p["id"]: p for p in listing.json()}
    assert pack["id"] in packs
    stickers = packs[pack["id"]]["stickers"]
    assert len(stickers) == 1
    assert stickers[0]["keyword"] == "cat"
    assert stickers[0]["image_url"].startswith("http")


async def test_non_admin_cannot_author(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    member_headers = await _headers(client, member)

    pack = await _create_pack(client, await _headers(client, admin), "Pack")
    asset = await _image_asset(session, admin.id)

    created = await client.post(
        "/api/stickerpacks", headers=member_headers, json={"name": "x"}
    )
    assert created.status_code == 403
    added = await client.post(
        f"/api/stickerpacks/{pack['id']}/stickers",
        headers=member_headers,
        json={"image_media_id": asset.id},
    )
    assert added.status_code == 403


async def test_sticker_bad_pack_or_asset(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    headers = await _headers(client, admin)
    pack = await _create_pack(client, headers, "Pack")

    # Несуществующий пак.
    no_pack = await client.post(
        "/api/stickerpacks/999999/stickers",
        headers=headers,
        json={"image_media_id": 1},
    )
    assert no_pack.status_code == 404

    # Несуществующий ассет.
    no_asset = await client.post(
        f"/api/stickerpacks/{pack['id']}/stickers",
        headers=headers,
        json={"image_media_id": 999999},
    )
    assert no_asset.status_code == 404

    # Не-image ассет.
    doc = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/x.pdf",
        kind="file",
        mime_type="application/pdf",
        size=10,
        created_by=admin.id,
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    not_image = await client.post(
        f"/api/stickerpacks/{pack['id']}/stickers",
        headers=headers,
        json={"image_media_id": doc.id},
    )
    assert not_image.status_code == 404


async def test_send_message_with_created_sticker(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)

    pack = await _create_pack(client, admin_headers, "Pack")
    asset = await _image_asset(session, admin.id)
    sticker = await client.post(
        f"/api/stickerpacks/{pack['id']}/stickers",
        headers=admin_headers,
        json={"image_media_id": asset.id},
    )
    sticker_id = sticker.json()["id"]

    room = await make_room(created_by=admin.id)
    await add_membership(room.id, admin.id, "owner")
    sent = await client.post(
        f"/api/rooms/{room.id}/messages",
        headers=admin_headers,
        json={"sticker_id": sticker_id},
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["sticker_id"] == sticker_id
