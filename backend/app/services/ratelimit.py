"""Rate-limiting на эфемерных счётчиках в Redis (SPEC §6.6, CLAUDE.md п.5).

Fixed-window: на первый удар по ключу ставим TTL окна, считаем INCR; превышение —
429 с Retry-After. Дёшево и достаточно для ~20–30 пользователей. Ключи — namespace
`rl:`. Глобальный выключатель `settings.rate_limit_enabled` (тесты/инциденты).
"""
from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.core.redis import redis_client


async def enforce_rate_limit(key: str, limit: int, window_seconds: int = 60) -> None:
    """Учесть удар по `key`; при превышении `limit` за окно — 429. Иначе тихо пройти."""
    if not settings.rate_limit_enabled:
        return
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, window_seconds)
    if count > limit:
        ttl = await redis_client.ttl(key)
        retry_after = ttl if ttl and ttl > 0 else window_seconds
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests, slow down",
            headers={"Retry-After": str(retry_after)},
        )


def client_ip(request: Request) -> str:
    """IP клиента. За nginx — первый `X-Forwarded-For` (наружу торчит только nginx,
    CLAUDE.md п.9, он и проставляет реальный IP), иначе адрес соединения."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
