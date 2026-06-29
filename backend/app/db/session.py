"""Async-движок и фабрика сессий SQLAlchemy.

Один движок на процесс. `get_session` — FastAPI-зависимость: открывает сессию на
запрос, коммитит при успехе, откатывает при исключении, всегда закрывает.
"""
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

engine: AsyncEngine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,   # отсеивать «протухшие» соединения (актуально при blue-green)
    future=True,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,   # объекты остаются пригодны после commit
    autoflush=False,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Зависимость: сессия БД на время запроса."""
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
