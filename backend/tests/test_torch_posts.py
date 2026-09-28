"""Посты стены профиля клуба «Факел» (ARG-155/164): создать, лента по
профилю, удалить (soft-delete). Видимость строго члены клуба
(`torch_unlocked=true`); удалить может автор или любой админ.
"""
from httpx import AsyncClient

from app.models.user import User

from .conftest import MakeUser, auth_headers, login


async def _headers(client: AsyncClient, user: User) -> dict[str, str]:
    tokens = await login(client, user.username, "initpass123")
    return auth_headers(tokens["access_token"])


async def test_non_member_forbidden_to_create_and_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    non_member = await make_user()
    member = await make_user(torch_unlocked=True)
    non_member_h = await _headers(client, non_member)

    create = await client.post(
        "/api/torch/posts", headers=non_member_h, json={"body": "привет"}
    )
    assert create.status_code == 403

    listed = await client.get(
        "/api/torch/posts", headers=non_member_h, params={"user_id": member.id}
    )
    assert listed.status_code == 403


async def test_non_member_forbidden_to_delete_existing_post(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """DELETE не гейтится `torch_unlocked` (см. docstring эндпоинта) — право
    решает авторство/роль, а не членство; не-член тоже получает 403 на ЧУЖОЙ
    существующий пост, не 404 (404 — только когда поста реально нет)."""
    author = await make_user(torch_unlocked=True)
    non_member = await make_user()
    author_h = await _headers(client, author)
    non_member_h = await _headers(client, non_member)

    post_id = (
        await client.post(
            "/api/torch/posts", headers=author_h, json={"body": "чужой для не-члена"}
        )
    ).json()["id"]

    delete = await client.delete(f"/api/torch/posts/{post_id}", headers=non_member_h)
    assert delete.status_code == 403


async def test_member_creates_post_and_sees_it_on_own_wall(
    client: AsyncClient, make_user: MakeUser
) -> None:
    member = await make_user(torch_unlocked=True)
    member_h = await _headers(client, member)

    create = await client.post(
        "/api/torch/posts", headers=member_h, json={"body": "мой первый пост"}
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["author_id"] == member.id
    assert body["author_display_name"] == member.display_name
    assert body["body"] == "мой первый пост"

    wall = await client.get(
        "/api/torch/posts", headers=member_h, params={"user_id": member.id}
    )
    assert wall.status_code == 200
    ids = {p["id"] for p in wall.json()}
    assert body["id"] in ids


async def test_other_member_sees_post_on_authors_wall(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user(torch_unlocked=True)
    other_member = await make_user(torch_unlocked=True)
    author_h = await _headers(client, author)
    other_h = await _headers(client, other_member)

    create = await client.post(
        "/api/torch/posts", headers=author_h, json={"body": "видно другим членам"}
    )
    assert create.status_code == 201
    post_id = create.json()["id"]

    wall = await client.get(
        "/api/torch/posts", headers=other_h, params={"user_id": author.id}
    )
    assert wall.status_code == 200
    ids = {p["id"] for p in wall.json()}
    assert post_id in ids


async def test_posts_ordered_newest_first(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user(torch_unlocked=True)
    author_h = await _headers(client, author)

    first = await client.post(
        "/api/torch/posts", headers=author_h, json={"body": "первый"}
    )
    second = await client.post(
        "/api/torch/posts", headers=author_h, json={"body": "второй"}
    )
    assert first.status_code == 201 and second.status_code == 201

    wall = (
        await client.get(
            "/api/torch/posts", headers=author_h, params={"user_id": author.id}
        )
    ).json()
    own_ids_in_order = [p["id"] for p in wall if p["id"] in {first.json()["id"], second.json()["id"]}]
    assert own_ids_in_order == [second.json()["id"], first.json()["id"]]


async def test_author_deletes_own_post(client: AsyncClient, make_user: MakeUser) -> None:
    author = await make_user(torch_unlocked=True)
    author_h = await _headers(client, author)

    post_id = (
        await client.post(
            "/api/torch/posts", headers=author_h, json={"body": "удалю сам"}
        )
    ).json()["id"]

    delete = await client.delete(f"/api/torch/posts/{post_id}", headers=author_h)
    assert delete.status_code == 204

    wall = (
        await client.get(
            "/api/torch/posts", headers=author_h, params={"user_id": author.id}
        )
    ).json()
    assert post_id not in {p["id"] for p in wall}


async def test_non_author_non_admin_cannot_delete_others_post(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user(torch_unlocked=True)
    other_member = await make_user(torch_unlocked=True)
    author_h = await _headers(client, author)
    other_h = await _headers(client, other_member)

    post_id = (
        await client.post(
            "/api/torch/posts", headers=author_h, json={"body": "чужой пост"}
        )
    ).json()["id"]

    delete = await client.delete(f"/api/torch/posts/{post_id}", headers=other_h)
    assert delete.status_code == 403

    # Пост жив — IDOR-проверка реальная, не только на клиенте.
    wall = (
        await client.get(
            "/api/torch/posts", headers=author_h, params={"user_id": author.id}
        )
    ).json()
    assert post_id in {p["id"] for p in wall}


async def test_admin_deletes_any_post_regardless_of_own_torch_unlocked(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user(torch_unlocked=True)
    admin = await make_user(role="admin")  # torch_unlocked=False по умолчанию
    assert admin.torch_unlocked is False
    author_h = await _headers(client, author)
    admin_h = await _headers(client, admin)

    post_id = (
        await client.post(
            "/api/torch/posts", headers=author_h, json={"body": "модерация"}
        )
    ).json()["id"]

    delete = await client.delete(f"/api/torch/posts/{post_id}", headers=admin_h)
    assert delete.status_code == 204


async def test_delete_missing_or_already_deleted_post_is_404(
    client: AsyncClient, make_user: MakeUser
) -> None:
    author = await make_user(torch_unlocked=True)
    author_h = await _headers(client, author)

    missing = await client.delete("/api/torch/posts/999999999", headers=author_h)
    assert missing.status_code == 404

    post_id = (
        await client.post(
            "/api/torch/posts", headers=author_h, json={"body": "once"}
        )
    ).json()["id"]
    first_delete = await client.delete(f"/api/torch/posts/{post_id}", headers=author_h)
    assert first_delete.status_code == 204
    second_delete = await client.delete(f"/api/torch/posts/{post_id}", headers=author_h)
    assert second_delete.status_code == 404


async def test_create_rejects_empty_body(client: AsyncClient, make_user: MakeUser) -> None:
    member = await make_user(torch_unlocked=True)
    member_h = await _headers(client, member)

    resp = await client.post("/api/torch/posts", headers=member_h, json={"body": ""})
    assert resp.status_code == 422
