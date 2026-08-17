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

from app.core.context import set_current_user_id
from app.core.security import ACCESS_TOKEN_TYPE, decode_token
from app.db.session import get_session
from app.models.user import User
from app.services.graduation import assert_not_graduated

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
    # С этого момента запрос опознан — лог наблюдаемости сможет назвать пользователя.
    set_current_user_id(user.id)
    return user


async def get_current_active_user(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Юзер обязан сменить временный пароль перед работой с платформой.

    Здесь же второй барьер — выпускная анкета: пока админ ждёт её от человека
    (`survey_required`), платформа закрыта целиком. Эндпоинты самой анкеты и
    `/api/auth/me` сидят на `get_current_user`, поэтому остаются доступны.
    """
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required",
        )
    if user.survey_required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Survey required",
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


async def require_participant(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Активный участник — НЕ наблюдатель. Наблюдатель имеет пассивный доступ
    «только к материалам» (см. is_observer): Рубка, Задачи, Календарь, Каюта,
    Динамика и уведомления для него закрыты. Админ наблюдателем не бывает."""
    if user.is_observer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Observer mode: this section is read-only for you",
        )
    return user


async def require_ongoing_participant(
    user: Annotated[User, Depends(require_participant)],
) -> User:
    """Участник, который ещё В ПУТИ: не наблюдатель и не выпускник.

    Выпускник (`graduated_at`, ставится отправкой выпускной анкеты) закончил
    экспедицию — Динамика для него исчезает целиком. У админа она остаётся: обзор
    в панели зовёт функции модуля напрямую, не по HTTP.
    """
    assert_not_graduated(user)
    return user


async def require_cabin_access(
    user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Доступ к личному разделу «Каюта». По умолчанию закрыт — админ выдаёт флаг
    can_access_cabin. Админ имеет доступ всегда (он же его и раздаёт).
    Наблюдатель Каюту теряет, даже если флаг ранее был выдан (пассивный доступ)."""
    if user.is_observer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Observer mode: this section is read-only for you",
        )
    if not user.can_access_cabin and user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cabin access not granted",
        )
    return user
