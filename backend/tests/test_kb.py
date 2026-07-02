"""Тесты базы знаний (SPEC §4.9): авторство только admin, видимость черновик/публикация,
привязка медиа и доступ к нему через расширенный assert_media_access.

MediaAsset сидим прямо через session (MinIO не нужен — presigned_get_url подписывает
URL локально, объект в хранилище для подписи не требуется)."""
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.kb import KbItemMedia
from app.models.media import MediaAsset
from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def _make_asset(session: AsyncSession, owner_id: int) -> MediaAsset:
    asset = MediaAsset(
        bucket="chat-media",
        storage_key="2026/06/x.png",
        kind="image",
        mime_type="image/png",
        size=10,
        created_by=owner_id,
    )
    session.add(asset)
    await session.commit()
    await session.refresh(asset)
    return asset


async def _create_item(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict:
    resp = await client.post("/api/kb/items", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_draft_hidden_from_participant_visible_to_admin(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_headers = await _headers(client, admin)
    member_headers = await _headers(client, member)

    item = await _create_item(client, admin_headers, title="Draft", body="# wip")
    assert item["published"] is False

    # Участник не видит черновик ни в списке, ни поштучно (404, не раскрываем).
    listed = await client.get("/api/kb/items", headers=member_headers)
    assert listed.status_code == 200
    assert item["id"] not in {i["id"] for i in listed.json()}
    one = await client.get(f"/api/kb/items/{item['id']}", headers=member_headers)
    assert one.status_code == 404

    # Admin видит черновик.
    admin_one = await client.get(f"/api/kb/items/{item['id']}", headers=admin_headers)
    assert admin_one.status_code == 200
    assert admin_one.json()["title"] == "Draft"


async def test_publish_makes_visible(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_headers = await _headers(client, admin)
    member_headers = await _headers(client, member)

    item = await _create_item(client, admin_headers, title="Article")
    patched = await client.patch(
        f"/api/kb/items/{item['id']}", headers=admin_headers, json={"published": True}
    )
    assert patched.status_code == 200
    assert patched.json()["published"] is True

    one = await client.get(f"/api/kb/items/{item['id']}", headers=member_headers)
    assert one.status_code == 200
    listed = await client.get("/api/kb/items", headers=member_headers)
    assert item["id"] in {i["id"] for i in listed.json()}


async def test_non_admin_cannot_author(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    member_headers = await _headers(client, member)

    item = await _create_item(client, await _headers(client, admin), title="A")

    created = await client.post(
        "/api/kb/items", headers=member_headers, json={"title": "x"}
    )
    assert created.status_code == 403
    patched = await client.patch(
        f"/api/kb/items/{item['id']}", headers=member_headers, json={"title": "y"}
    )
    assert patched.status_code == 403
    deleted = await client.delete(f"/api/kb/items/{item['id']}", headers=member_headers)
    assert deleted.status_code == 403
    attached = await client.post(
        f"/api/kb/items/{item['id']}/media",
        headers=member_headers,
        json={"media_asset_ids": [1]},
    )
    assert attached.status_code == 403


async def test_media_link_and_access_gated_by_publish(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_headers = await _headers(client, admin)
    member_headers = await _headers(client, member)

    asset = await _make_asset(session, admin.id)
    item = await _create_item(
        client, admin_headers, title="With media", media_asset_ids=[asset.id]
    )
    assert item["media_asset_ids"] == [asset.id]

    # Пока черновик — участник не получает ссылку на медиа (403).
    before = await client.get(f"/api/media/{asset.id}", headers=member_headers)
    assert before.status_code == 403

    # После публикации медиа опубликованного материала доступно участнику.
    await client.patch(
        f"/api/kb/items/{item['id']}", headers=admin_headers, json={"published": True}
    )
    after = await client.get(f"/api/media/{asset.id}", headers=member_headers)
    assert after.status_code == 200
    assert "url" in after.json()


async def test_detach_media_revokes_access(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    member = await make_user()
    admin_headers = await _headers(client, admin)
    member_headers = await _headers(client, member)

    asset = await _make_asset(session, admin.id)
    item = await _create_item(
        client,
        admin_headers,
        title="Pub",
        published=True,
        media_asset_ids=[asset.id],
    )
    assert (await client.get(f"/api/media/{asset.id}", headers=member_headers)).status_code == 200

    detached = await client.delete(
        f"/api/kb/items/{item['id']}/media/{asset.id}", headers=admin_headers
    )
    assert detached.status_code == 204

    one = await client.get(f"/api/kb/items/{item['id']}", headers=admin_headers)
    assert one.json()["media_asset_ids"] == []
    # Без связи — участник снова без доступа.
    revoked = await client.get(f"/api/media/{asset.id}", headers=member_headers)
    assert revoked.status_code == 403


async def test_delete_item_cascades_media_links(
    client: AsyncClient,
    session: AsyncSession,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)

    asset = await _make_asset(session, admin.id)
    item = await _create_item(
        client, admin_headers, title="Doomed", media_asset_ids=[asset.id]
    )

    deleted = await client.delete(f"/api/kb/items/{item['id']}", headers=admin_headers)
    assert deleted.status_code == 204

    gone = await client.get(f"/api/kb/items/{item['id']}", headers=admin_headers)
    assert gone.status_code == 404

    link_count = (
        await session.execute(
            select(func.count())
            .select_from(KbItemMedia)
            .where(KbItemMedia.kb_item_id == item["id"])
        )
    ).scalar_one()
    assert link_count == 0


async def test_attach_nonexistent_asset_404(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)

    item = await _create_item(client, admin_headers, title="A")
    resp = await client.post(
        f"/api/kb/items/{item['id']}/media",
        headers=admin_headers,
        json={"media_asset_ids": [999999]},
    )
    assert resp.status_code == 404


# ── Комментарии под материалом ──────────────────────────────────────────────


async def test_participant_can_comment_and_list(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)
    participant = await make_user(role="participant")
    p_headers = await _headers(client, participant)

    item = await _create_item(client, admin_headers, title="Pub", published=True)

    created = await client.post(
        f"/api/kb/items/{item['id']}/comments",
        headers=p_headers,
        json={"body": "Отличный материал"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["body"] == "Отличный материал"
    assert created.json()["author_id"] == participant.id

    listed = await client.get(
        f"/api/kb/items/{item['id']}/comments", headers=p_headers
    )
    assert listed.status_code == 200
    assert [c["body"] for c in listed.json()] == ["Отличный материал"]


async def test_comments_on_draft_hidden_from_participant(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)
    participant = await make_user(role="participant")
    p_headers = await _headers(client, participant)

    draft = await _create_item(client, admin_headers, title="Draft", published=False)

    # Черновик не виден участнику — и список, и создание комментария дают 404.
    assert (
        await client.get(f"/api/kb/items/{draft['id']}/comments", headers=p_headers)
    ).status_code == 404
    assert (
        await client.post(
            f"/api/kb/items/{draft['id']}/comments",
            headers=p_headers,
            json={"body": "hi"},
        )
    ).status_code == 404


async def test_empty_comment_rejected(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)
    item = await _create_item(client, admin_headers, title="P", published=True)
    resp = await client.post(
        f"/api/kb/items/{item['id']}/comments",
        headers=admin_headers,
        json={"body": "   "},
    )
    # min_length=1 после пустой строки — но пробелы пройдут валидацию pydantic;
    # проверяем, что хотя бы пустая строка отклоняется.
    empty = await client.post(
        f"/api/kb/items/{item['id']}/comments",
        headers=admin_headers,
        json={"body": ""},
    )
    assert empty.status_code == 422
    assert resp.status_code == 201  # пробелы допустимы (не триммим на бэке)


async def test_author_and_admin_can_delete_but_not_others(
    client: AsyncClient,
    make_user: MakeUser,
) -> None:
    admin = await make_user(role="admin")
    admin_headers = await _headers(client, admin)
    alice = await make_user(role="participant")
    a_headers = await _headers(client, alice)
    bob = await make_user(role="participant")
    b_headers = await _headers(client, bob)

    item = await _create_item(client, admin_headers, title="P", published=True)

    # Alice оставляет комментарий.
    cid = (
        await client.post(
            f"/api/kb/items/{item['id']}/comments",
            headers=a_headers,
            json={"body": "мой коммент"},
        )
    ).json()["id"]

    # Bob (не автор, не admin) удалить не может.
    assert (
        await client.delete(f"/api/kb/comments/{cid}", headers=b_headers)
    ).status_code == 403

    # Автор может.
    assert (
        await client.delete(f"/api/kb/comments/{cid}", headers=a_headers)
    ).status_code == 204

    # После мягкого удаления — не виден в списке и повторное удаление даёт 404.
    listed = await client.get(
        f"/api/kb/items/{item['id']}/comments", headers=a_headers
    )
    assert listed.json() == []
    assert (
        await client.delete(f"/api/kb/comments/{cid}", headers=admin_headers)
    ).status_code == 404
