"""Тесты заведения юзеров админом и обязательной смены временного пароля."""
import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from .conftest import AddMembership, MakeRoom, MakeUser, auth_headers, login


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

    # /me доступен при must_change_password — фронт должен видеть флаг для редиректа.
    me_early = await client.get(
        "/api/auth/me", headers=auth_headers(user_tokens["access_token"])
    )
    assert me_early.status_code == 200
    assert me_early.json()["must_change_password"] is True

    # Остальные защищённые эндпоинты закрыты до смены пароля.
    blocked = await client.get(
        "/api/users", headers=auth_headers(user_tokens["access_token"])
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


async def test_admin_list_users_includes_can_create_groups(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """GET /api/admin/users возвращает can_create_groups для каждого пользователя."""
    admin = await make_user(role="admin", password="adminpass123")
    participant = await make_user(role="participant", can_create_groups=False)
    tokens = await login(client, admin.username, "adminpass123")

    resp = await client.get(
        "/api/admin/users",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)

    # Каждый элемент содержит обязательные admin-поля
    for item in body:
        assert "can_create_groups" in item
        assert "email" in item
        assert "role" in item
        assert "created_at" in item

    # Конкретный участник с can_create_groups=False возвращается с правильным значением
    participant_data = next((u for u in body if u["id"] == participant.id), None)
    assert participant_data is not None
    assert participant_data["can_create_groups"] is False

    # Админ по умолчанию имеет can_create_groups=True
    admin_data = next((u for u in body if u["id"] == admin.id), None)
    assert admin_data is not None
    assert admin_data["can_create_groups"] is True


async def test_non_admin_cannot_list_users(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """GET /api/admin/users возвращает 403 для не-администратора."""
    user = await make_user(role="participant", password="initpass123")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.get(
        "/api/admin/users",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 403


async def test_admin_delete_user_removes_personal_footprint(
    client: AsyncClient,
    make_user: MakeUser,
    make_room: MakeRoom,
    add_membership: AddMembership,
    session: AsyncSession,
) -> None:
    """DELETE /api/admin/users/{id} удаляет юзера, его сообщения, членства и личный канал."""
    from sqlalchemy import select

    from app.models.message import Message
    from app.models.room import Room, RoomMember
    from app.models.user import User

    admin = await make_user(role="admin", password="adminpass123")
    victim = await make_user(role="participant")

    # Личный канал жертвы + групповая комната (создал админ), где жертва — участник.
    personal = await make_room(created_by=victim.id, type="channel", name="Victim")
    personal.is_personal = True
    group = await make_room(created_by=admin.id, type="group")
    await add_membership(group.id, victim.id, "member")
    # Сообщение жертвы в группе.
    session.add(Message(room_id=group.id, sender_id=victim.id, content="hi"))
    await session.commit()

    tokens = await login(client, admin.username, "adminpass123")
    resp = await client.delete(
        f"/api/admin/users/{victim.id}",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 204

    # Эндпоинт коммитил в своей сессии. Читаем свежими select-запросами (а не
    # session.get, который вернул бы закешированные в identity-map объекты).
    assert (
        await session.scalar(select(User.id).where(User.id == victim.id))
    ) is None
    assert (
        await session.scalar(select(Room.id).where(Room.id == personal.id))
    ) is None
    assert (
        await session.scalar(
            select(RoomMember).where(RoomMember.user_id == victim.id)
        )
    ) is None
    assert (
        await session.scalar(
            select(Message).where(Message.sender_id == victim.id)
        )
    ) is None


async def test_admin_cannot_delete_self(
    client: AsyncClient, make_user: MakeUser
) -> None:
    admin = await make_user(role="admin", password="adminpass123")
    tokens = await login(client, admin.username, "adminpass123")
    resp = await client.delete(
        f"/api/admin/users/{admin.id}",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 400


async def test_admin_delete_user_blocked_by_owned_content(
    client: AsyncClient,
    make_user: MakeUser,
    session: AsyncSession,
) -> None:
    """Удаление отклоняется 409, если юзер владеет долгоиграющим контентом (статья БЗ)."""
    from app.models.kb import KbItem

    admin = await make_user(role="admin", password="adminpass123")
    author = await make_user(role="participant")
    session.add(KbItem(title="Article", created_by=author.id))
    await session.commit()

    tokens = await login(client, admin.username, "adminpass123")
    resp = await client.delete(
        f"/api/admin/users/{author.id}",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 409


async def test_non_admin_cannot_delete_user(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user(role="participant", password="initpass123")
    victim = await make_user(role="participant")
    tokens = await login(client, user.username, "initpass123")
    resp = await client.delete(
        f"/api/admin/users/{victim.id}",
        headers=auth_headers(tokens["access_token"]),
    )
    assert resp.status_code == 403
