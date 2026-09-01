"""Общие хелперы профиля пользователя — аватар и денормализация имени тарифа.

Вынесены из api/users.py, т.к. используются и в api/argonauts.py (та же
подпись «аватар + тариф» для карточек участников).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan import Plan
from app.models.user import User


async def plan_names(session: AsyncSession, users: list[User]) -> dict[int, str]:
    plan_ids = {u.plan_id for u in users if u.plan_id is not None}
    if not plan_ids:
        return {}
    rows = await session.execute(select(Plan.id, Plan.name).where(Plan.id.in_(plan_ids)))
    # .tuples() — обычные кортежи вместо Row: dict() их принимает, и mypy это видит.
    return dict(rows.tuples().all())


def avatar_url(user: User, signed: dict[int, str]) -> str | None:
    if user.avatar_media_id is not None:
        return signed.get(user.avatar_media_id)
    return user.avatar_url
