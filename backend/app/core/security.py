"""Безопасность: хеширование паролей (argon2) и JWT (access/refresh).

Access-токены stateless (нигде не хранятся). Refresh-токены несут `jti` —
чтобы реализовать отзыв/логаут устройств через Redis (эфемерное состояние, п.5).
Сам отзыв — логика фич; здесь только генерация и декод.
"""
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_hasher = PasswordHasher()

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


# --- Пароли (argon2) ---

def hash_password(password: str) -> str:
    return _hasher.hash(password)


def generate_one_time_password() -> str:
    """Криптостойкий одноразовый пароль для заведения юзера админом.

    Хранится только argon2-хешем; plaintext отдаётся админу один раз.
    """
    return secrets.token_urlsafe(9)  # ~12 символов из безопасного алфавита


def verify_password(password_hash: str, password: str) -> bool:
    """True, если пароль соответствует хешу. Невалидный хеш/несовпадение -> False."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """Параметры argon2 устарели — стоит перехешировать при следующем успешном входе."""
    return _hasher.check_needs_rehash(password_hash)


# --- JWT ---

def _encode(payload: dict[str, Any], expires_delta: timedelta, token_type: str) -> str:
    now = datetime.now(UTC)
    to_encode = {
        **payload,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_access_token(sub: str | int, extra: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {"sub": str(sub)}
    if extra:
        payload.update(extra)
    return _encode(
        payload,
        timedelta(minutes=settings.jwt_access_ttl_minutes),
        ACCESS_TOKEN_TYPE,
    )


def create_refresh_token(sub: str | int) -> tuple[str, str]:
    """Возвращает (token, jti). jti кладётся в Redis для возможности отзыва."""
    jti = str(uuid4())
    token = _encode(
        {"sub": str(sub), "jti": jti},
        timedelta(days=settings.jwt_refresh_ttl_days),
        REFRESH_TOKEN_TYPE,
    )
    return token, jti


def decode_token(token: str) -> dict[str, Any]:
    """Декодирует и валидирует подпись/срок. Бросает jwt.PyJWTError при ошибке."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )
