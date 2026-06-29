"""Эндпоинты аутентификации: login / refresh / logout / change-password / me."""
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_current_user
from app.core.security import (
    REFRESH_TOKEN_TYPE,
    decode_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.db.session import get_session
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    TokenPair,
)
from app.schemas.user import UserOut
from app.services.auth import issue_token_pair, refresh_is_valid, revoke_refresh

router = APIRouter(prefix="/api/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid username or password",
)
_INVALID_REFRESH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired refresh token",
)


@router.post("/login", response_model=TokenPair)
async def login(
    body: LoginRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenPair:
    user = (
        await session.execute(select(User).where(User.username == body.username))
    ).scalar_one_or_none()
    # Один и тот же ответ для «нет юзера» и «неверный пароль» — без энумерации.
    if user is None or not verify_password(user.password_hash, body.password):
        raise _INVALID_CREDENTIALS
    # Параметры argon2 устарели — прозрачно перехешируем при успешном входе.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    return await issue_token_pair(user.id)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest) -> TokenPair:
    try:
        payload = decode_token(body.refresh_token)
    except jwt.PyJWTError as exc:
        raise _INVALID_REFRESH from exc
    if payload.get("type") != REFRESH_TOKEN_TYPE:
        raise _INVALID_REFRESH
    jti, sub = payload.get("jti"), payload.get("sub")
    if not jti or sub is None or not await refresh_is_valid(jti):
        raise _INVALID_REFRESH
    # Ротация: гасим предъявленный refresh и выдаём новую пару.
    await revoke_refresh(jti)
    return await issue_token_pair(int(sub))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest) -> Response:
    # Не валим запрос на битом токене — logout идемпотентен.
    try:
        payload = decode_token(body.refresh_token)
        jti = payload.get("jti")
    except jwt.PyJWTError:
        jti = None
    if jti:
        await revoke_refresh(jti)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    # Намеренно get_current_user (не active): доступно при must_change_password.
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await session.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(get_current_active_user)]) -> User:
    return user
