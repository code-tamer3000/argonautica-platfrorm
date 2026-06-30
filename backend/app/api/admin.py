"""Админские эндпоинты. Платформа закрытая — пользователей заводит только админ."""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.security import generate_one_time_password, hash_password
from app.db.session import get_session
from app.models.user import User
from sqlalchemy import select

from app.schemas.user import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    AdminUpdateUserRequest,
    AdminUserOut,
    UserOut,
)

# Поля, которые админу разрешено править через PATCH. Расширяется добавлением имени
# сюда и поля в AdminUpdateUserRequest (напр. будущие role/is_banned).
_PATCHABLE_FIELDS = {"can_create_groups"}

# Весь роутер под require_admin — каждый запрос проверяет роль на сервере (п.1).
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[User]:
    """Список пользователей с admin-полями (включая can_create_groups)."""
    result = await session.execute(select(User).order_by(User.display_name))
    return list(result.scalars().all())


@router.post(
    "/users",
    response_model=AdminCreateUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    body: AdminCreateUserRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AdminCreateUserResponse:
    """Создать юзера. Сервер генерит одноразовый пароль и отдаёт его ОДИН раз."""
    one_time_password = generate_one_time_password()
    user = User(
        username=body.username,
        display_name=body.display_name,
        email=body.email,
        role=body.role,
        password_hash=hash_password(one_time_password),
        must_change_password=True,
    )
    session.add(user)
    try:
        await session.flush()  # получаем id и ловим конфликт уникальности
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already exists",
        ) from exc
    return AdminCreateUserResponse(
        id=user.id,
        username=user.username,
        one_time_password=one_time_password,
    )


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: AdminUpdateUserRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Частичное обновление юзера: применяем только переданные whitelisted-поля."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(user, field, value)
    if changes:
        user.updated_at = datetime.now(UTC)
    await session.flush()
    return user
