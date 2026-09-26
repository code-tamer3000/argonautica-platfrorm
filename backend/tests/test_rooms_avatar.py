"""Обложка комнаты (`PATCH /api/rooms/{id}/avatar`): для личного дневника — только
владелец, для группы — владелец группы или platform-admin (ARG-154). Видна всем, кто
видит эту комнату. Аватар-ассеты сидим через session (MinIO не нужен — presigned-URL
подписывается локально), тот же паттерн, что и test_profile.py."""
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.media import MediaAsset
from app.models.room import Room, RoomMember
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _image_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/cover.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def _personal_room(session: AsyncSession, owner: User) -> Room:
    room = Room(type="channel", name=owner.display_name, is_personal=True, created_by=owner.id)
    session.add(room)
    await session.commit()
    await session.refresh(room)
    return room


async def test_owner_sets_and_clears_diary_avatar(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    room = await _personal_room(session, owner)
    asset = await _image_asset(session, owner.id)
    headers = await _headers(client, owner)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar", headers=headers, json={"avatar_media_id": asset.id}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar_url"] and resp.json()["avatar_url"].startswith("http")

    # Приходит и в остальных выдачах комнаты.
    listed = await client.get("/api/rooms", headers=headers)
    room_out = next(r for r in listed.json() if r["id"] == room.id)
    assert room_out["avatar_url"] and room_out["avatar_url"].startswith("http")

    got = await client.get(f"/api/rooms/{room.id}", headers=headers)
    assert got.json()["avatar_url"] and got.json()["avatar_url"].startswith("http")

    personal = await client.get("/api/rooms/personal", headers=headers)
    assert personal.json()["avatar_url"] and personal.json()["avatar_url"].startswith("http")

    # Снятие (null) → avatar_url снова None везде.
    cleared = await client.patch(
        f"/api/rooms/{room.id}/avatar", headers=headers, json={"avatar_media_id": None}
    )
    assert cleared.status_code == 200
    assert cleared.json()["avatar_url"] is None


async def test_stream_mate_sees_owners_diary_avatar(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    mate = await make_user(intake_id=owner.intake_id)
    room = await _personal_room(session, owner)
    asset = await _image_asset(session, owner.id)

    owner_headers = await _headers(client, owner)
    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=owner_headers,
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 200

    mate_headers = await _headers(client, mate)
    got = await client.get(f"/api/rooms/{room.id}", headers=mate_headers)
    assert got.status_code == 200
    assert got.json()["avatar_url"] and got.json()["avatar_url"].startswith("http")


async def test_cannot_set_avatar_on_others_diary(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    intruder = await make_user(intake_id=owner.intake_id)
    room = await _personal_room(session, owner)
    asset = await _image_asset(session, intruder.id)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, intruder),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 403


async def test_cannot_set_avatar_on_non_personal_non_group_room(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    """Обычный канал не поддерживает установку аватарки этим эндпоинтом (см.
    docs/ROOMS.md — у канала пока нет своего set-эндпоинта)."""
    owner = await make_user()
    room = Room(type="channel", name="Канал", is_personal=False, created_by=owner.id)
    session.add(room)
    await session.commit()
    await session.refresh(room)
    asset = await _image_asset(session, owner.id)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, owner),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 403


async def _group_with_owner(session: AsyncSession, owner: User) -> Room:
    room = Room(type="group", name="Группа", is_personal=False, created_by=owner.id)
    session.add(room)
    await session.flush()
    session.add(RoomMember(room_id=room.id, user_id=owner.id, role_in_room="owner"))
    await session.commit()
    await session.refresh(room)
    return room


async def test_group_owner_sets_and_clears_avatar(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    room = await _group_with_owner(session, owner)
    asset = await _image_asset(session, owner.id)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, owner),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar_url"] and resp.json()["avatar_url"].startswith("http")

    cleared = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, owner),
        json={"avatar_media_id": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["avatar_url"] is None


async def test_platform_admin_sets_group_avatar(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    admin = await make_user(role="admin")
    room = await _group_with_owner(session, owner)
    asset = await _image_asset(session, admin.id)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, admin),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 200, resp.text


async def test_regular_member_cannot_set_group_avatar(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    member = await make_user(intake_id=owner.intake_id)
    room = await _group_with_owner(session, owner)
    session.add(RoomMember(room_id=room.id, user_id=member.id, role_in_room="member"))
    await session.commit()
    asset = await _image_asset(session, member.id)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, member),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 403


async def test_cannot_use_others_asset_for_diary_avatar(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    other = await make_user()
    room = await _personal_room(session, owner)
    asset = await _image_asset(session, other.id)  # принадлежит other

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, owner),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 403


async def test_diary_avatar_must_be_image(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    owner = await make_user()
    room = await _personal_room(session, owner)
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/doc.pdf",
        kind="file",
        mime_type="application/pdf",
        size=10,
        created_by=owner.id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)

    resp = await client.patch(
        f"/api/rooms/{room.id}/avatar",
        headers=await _headers(client, owner),
        json={"avatar_media_id": asset.id},
    )
    assert resp.status_code == 404
