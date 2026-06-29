"""Логика сессий: белый список refresh-токенов в Redis (отзыв/ротация).

Refresh-токены — эфемерное состояние, живут в Redis (CLAUDE.md п.5), не в Postgres.
Белый список: токен валиден, только пока его `jti` лежит в Redis. Это даёт отзыв
(logout) и ротацию (на /refresh старый jti удаляется, выдаётся новый).
Access-токены stateless — нигде не хранятся.
"""
from app.core.config import settings
from app.core.redis import redis_client
from app.core.security import create_access_token, create_refresh_token
from app.schemas.auth import TokenPair

_REFRESH_TTL_SECONDS = settings.jwt_refresh_ttl_days * 24 * 60 * 60


def _key(jti: str) -> str:
    return f"refresh:{jti}"


async def store_refresh(jti: str, user_id: int) -> None:
    await redis_client.set(_key(jti), str(user_id), ex=_REFRESH_TTL_SECONDS)


async def refresh_is_valid(jti: str) -> bool:
    return await redis_client.exists(_key(jti)) == 1


async def revoke_refresh(jti: str) -> None:
    """Идемпотентно: удалить отсутствующий ключ — не ошибка."""
    await redis_client.delete(_key(jti))


async def issue_token_pair(user_id: int) -> TokenPair:
    """Выдать access+refresh и занести refresh в белый список. Общая для login и refresh."""
    access = create_access_token(user_id)
    refresh, jti = create_refresh_token(user_id)
    await store_refresh(jti, user_id)
    return TokenPair(access_token=access, refresh_token=refresh)
