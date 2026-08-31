"""Директория пользователей (§4.2): список, контакты для «начать чат», профиль.

Платформа закрытая — `GET /api/users` отдаёт ВСЕХ (имена/аватары/тарифы), это
lookup-таблица для рендера уже видимых сообщений/задач/КБ, не ростер (используется
в 15+ местах фронта — сужать её нельзя, сломает рендер чужих отправителей). Ростер
кандидатов для DM/группы — отдельный, каскадно фильтрованный `GET /api/users/contacts`
(ARG-110). Свой профиль редактируется в `api/auth.py` (`/api/auth/me`). Аватар —
подписанный media-URL (если задан) или legacy `avatar_url`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.core.redis import redis_client
from app.db.session import get_session
from app.models.plan import Plan
from app.models.user import User
from app.schemas.user import PublicUserOut
from app.services.media import presign_asset_urls
from app.services.visibility import cohort_plan_ranks, contact_visible, user_rank

router = APIRouter(prefix="/api/users", tags=["users"])


async def _plan_names(session: AsyncSession, users: list[User]) -> dict[int, str]:
    plan_ids = {u.plan_id for u in users if u.plan_id is not None}
    if not plan_ids:
        return {}
    rows = await session.execute(select(Plan.id, Plan.name).where(Plan.id.in_(plan_ids)))
    # .tuples() — обычные кортежи вместо Row: dict() их принимает, и mypy это видит.
    return dict(rows.tuples().all())


def _public_out(
    user: User, avatar_url: str | None, plan_names: dict[int, str]
) -> PublicUserOut:
    return PublicUserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=avatar_url,
        bio=user.bio,
        role=user.role,
        plan_id=user.plan_id,
        plan_name=plan_names.get(user.plan_id) if user.plan_id is not None else None,
    )


def _avatar(user: User, signed: dict[int, str]) -> str | None:
    if user.avatar_media_id is not None:
        return signed.get(user.avatar_media_id)
    return user.avatar_url


@router.get("", response_model=list[PublicUserOut])
async def list_users(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PublicUserOut]:
    """Все пользователи платформы — lookup для рендера (см. модуль). НЕ ростер
    «начать чат»: тот эндпоинт — `GET /api/users/contacts`."""
    users = list(
        (await session.execute(select(User).order_by(User.display_name)))
        .scalars()
        .all()
    )
    media_ids = {u.avatar_media_id for u in users if u.avatar_media_id is not None}
    signed = await presign_asset_urls(session, media_ids)
    plan_names = await _plan_names(session, users)
    return [_public_out(u, _avatar(u, signed), plan_names) for u in users]


@router.get("/contacts", response_model=list[PublicUserOut])
async def list_contacts(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    intake_id: Annotated[int | None, Query()] = None,
) -> list[PublicUserOut]:
    """Ростер кандидатов для «начать чат»/группу (ARG-110) — каскадная видимость
    по рангу тарифа внутри потока, не плоский список всей платформы.

    Участник: свой intake_id (клиентский `intake_id` игнорируется — не доверяем
    id с клиента, п.1 CLAUDE.md), видит участников своего потока с рангом тарифа
    <= своему, плюс навигаторов/топ-2-доступных админов. Admin: полный список
    выбранного `intake_id` (сессионный фильтр `adminCurrentIntakeId` фронта, не
    новое ограничение — админ как и раньше имеет полный доступ); без параметра —
    вся платформа. Отдаём отсортированными по рангу тарифа (по возрастанию) —
    фронт группирует секции по соседним элементам, не пересчитывая ранги сам.
    """
    if current_user.role == "admin":
        stmt = select(User).where(User.id != current_user.id)
        if intake_id is not None:
            stmt = stmt.where(User.intake_id == intake_id)
        candidates = list((await session.execute(stmt)).scalars().all())
        ranks = await cohort_plan_ranks(session, intake_id) if intake_id is not None else {}
    else:
        candidates_all = list(
            (
                await session.execute(
                    select(User).where(User.intake_id == current_user.intake_id)
                )
            )
            .scalars()
            .all()
        )
        ranks = await cohort_plan_ranks(session, current_user.intake_id)
        candidates = [
            u for u in candidates_all if contact_visible(current_user, u, ranks)
        ]

    # Админы — отдельным хвостовым блоком (роль, не ранг тарифа), иначе безтарифный
    # админ и безтарифный участник (оба ранга 0) перемешались бы по алфавиту.
    candidates.sort(key=lambda u: (u.role == "admin", user_rank(u, ranks), u.display_name))
    media_ids = {u.avatar_media_id for u in candidates if u.avatar_media_id is not None}
    signed = await presign_asset_urls(session, media_ids)
    plan_names = await _plan_names(session, candidates)
    return [_public_out(u, _avatar(u, signed), plan_names) for u in candidates]


@router.get("/presence", response_model=list[int])
async def get_online_users(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> list[int]:
    """Текущий снепшот онлайн-пользователей из Redis (для первичной загрузки)."""
    members = await redis_client.smembers("presence:online")
    return [int(m) for m in members]


@router.get("/{user_id}", response_model=PublicUserOut)
async def get_user(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PublicUserOut:
    """Публичный профиль пользователя."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    media_ids = {user.avatar_media_id} if user.avatar_media_id is not None else set()
    signed = await presign_asset_urls(session, media_ids)
    plan_names = await _plan_names(session, [user])
    return _public_out(user, _avatar(user, signed), plan_names)
