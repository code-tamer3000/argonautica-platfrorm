"""Async-движок и фабрика сессий SQLAlchemy.

Один движок на процесс. `get_session` — FastAPI-зависимость: открывает сессию на
запрос, коммитит при успехе, откатывает при исключении, всегда закрывает.

After-commit hooks: сайд-эффекты, которые НЕЛЬЗЯ выполнять до коммита (публикация
в WS/Redis, push). Если опубликовать событие до commit, а commit потом упадёт
(blue-green, обрыв Postgres, констрейнт), подписчики уже увидят сообщение, а в БД
его не будет — «отправлено, но потерялось». Хендлеры регистрируют сайд-эффект через
`after_commit(...)`, а `get_session` запускает его ТОЛЬКО после успешного commit.
"""
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

logger = logging.getLogger(__name__)

# Ключ в session.info со списком отложенных до коммита сайд-эффектов.
_AFTER_COMMIT_KEY = "after_commit_hooks"


def after_commit(session: AsyncSession, hook: Callable[[], Awaitable[None]]) -> None:
    """Отложить сайд-эффект (WS-публикация, push) до успешного commit сессии.

    `hook` — фабрика корутины без аргументов (напр. `lambda: publish_room_event(...)`);
    вызывается после commit в `get_session`. При откате транзакции хук НЕ выполняется.
    """
    session.info.setdefault(_AFTER_COMMIT_KEY, []).append(hook)


async def _run_after_commit(session: AsyncSession) -> None:
    hooks: list[Callable[[], Awaitable[None]]] = session.info.pop(
        _AFTER_COMMIT_KEY, []
    )
    for hook in hooks:
        # Один упавший сайд-эффект (Redis недоступен и т.п.) не должен глушить
        # остальные и не должен ронять уже успешный запрос — данные закоммичены.
        try:
            await hook()
        except Exception:
            logger.exception("after_commit hook failed")

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
    """Зависимость: сессия БД на время запроса.

    Порядок строгий: commit → отложенные сайд-эффекты. WS-публикации/push,
    зарегистрированные через `after_commit`, выполняются ТОЛЬКО после успешного
    commit, поэтому подписчики никогда не увидят сообщение, которого нет в БД.
    """
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        await _run_after_commit(session)
