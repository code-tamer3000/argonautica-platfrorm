"""Тесты заведения юзеров админом и обязательной смены временного пароля."""
import uuid

from httpx import AsyncClient

from .conftest import MakeUser, auth_headers, login


async def test_non_admin_cannot_create_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.post(
        "/api/admin/users",
        headers=auth_headers(tokens["access_token"]),
        json={"username": "newbie", "display_name": "Newbie"},
    )
    assert resp.status_code == 403


async def test_admin_create_user_and_forced_password_change(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    admin_tokens = await login(client, admin.username, "adminpass123")

    # Админ заводит юзера — сервер возвращает одноразовый пароль ОДИН раз.
    new_username = f"tg_{uuid.uuid4().hex[:8]}"
    created = await client.post(
        "/api/admin/users",
        headers=auth_headers(admin_tokens["access_token"]),
        json={"username": new_username, "display_name": "TG User"},
    )
    assert created.status_code == 201
    body = created.json()
    temp_password = body["one_time_password"]
    assert temp_password and body["username"] == new_username

    # Новый юзер логинится по временному паролю...
    user_tokens = await login(client, new_username, temp_password)

    # ...но до смены пароля защищённые эндпоинты закрыты (must_change_password).
    blocked = await client.get(
        "/api/auth/me", headers=auth_headers(user_tokens["access_token"])
    )
    assert blocked.status_code == 403

    # Смена пароля требует текущий и снимает флаг.
    changed = await client.post(
        "/api/auth/change-password",
        headers=auth_headers(user_tokens["access_token"]),
        json={"current_password": temp_password, "new_password": "brandNew123"},
    )
    assert changed.status_code == 204

    # Теперь /me доступен, флаг снят, и вход идёт по новому паролю.
    fresh = await login(client, new_username, "brandNew123")
    me = await client.get("/api/auth/me", headers=auth_headers(fresh["access_token"]))
    assert me.status_code == 200
    assert me.json()["must_change_password"] is False


async def test_change_password_wrong_current(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(must_change=True, password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.post(
        "/api/auth/change-password",
        headers=auth_headers(tokens["access_token"]),
        json={"current_password": "WRONG", "new_password": "brandNew123"},
    )
    assert resp.status_code == 400


async def test_duplicate_username_conflict(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    existing = await make_user(role="participant")
    resp = await client.post(
        "/api/admin/users",
        headers=auth_headers(tokens["access_token"]),
        json={"username": existing.username, "display_name": "Dup"},
    )
    assert resp.status_code == 409
