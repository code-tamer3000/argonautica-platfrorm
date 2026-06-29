"""Зависимости авторизации.

Авторизация проверяется на КАЖДОМ запросе на сервере (CLAUDE.md п.1). Цепочка:
get_current_user (валидный access + существующий юзер)
  -> get_current_active_user (+ временный пароль уже сменён)
    -> require_admin (+ роль admin).
"""
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ACCESS_TOKEN_TYPE, decode_token
from app.db.session import get_session
from app.models.user import User

bearer = HTTPBearer()

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired token",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Декодирует access-токен и загружает пользователя. Любая ошибка -> 401."""
    try:
        payload = decode_token(creds.credentials)
    except jwt.PyJWTError as exc:
        raise _CREDENTIALS_ERROR from exc

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise _CREDENTIALS_ERROR
    sub = payload.get("sub")
    if sub is None:
        raise _CREDENTIALS_ERROR

    user = await session.get(User, int(sub))
    if user is None:
        raise _CREDENTIALS_ERROR
    return user


async def get_current_active_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Юзер обязан сменить временный пароль перед работой с платформой."""
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required",
        )
    return user


async def require_admin(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return user
