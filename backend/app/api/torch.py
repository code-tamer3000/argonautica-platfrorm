"""Клуб «Факел» (ARG-54) — пользовательская сторона: заглушка + контакты раздела.

Комнаты раздела (и singleton-чат клуба, и dm/группы, созданные внутри него) —
обычные `rooms`, находятся клиентом через `GET /api/rooms` по `torch_scope`,
доступ — стандартный `assert_room_access`/`assert_can_write`
(см. app/services/rooms.py). Отдельные эндпоинты здесь — то, чего в общем
`/api/rooms`/`/api/users` нет: текст заглушки для тех, у кого `torch_unlocked=False`,
и контакт-лист раздела (свой круг видимости, не рангового каскада тарифов).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.intake import Intake
from app.models.torch import TorchPost
from app.models.user import User
from app.schemas.torch import (
    TorchApplyOut,
    TorchPostCreate,
    TorchPostOut,
    TorchStubOut,
)
from app.schemas.user import PublicUserOut
from app.services.media import presign_asset_urls
from app.services.rooms import get_or_create_dm
from app.services.torch import get_or_create_torch_settings
from app.services.users import avatar_url

router = APIRouter(prefix="/api/torch", tags=["torch"])


def _require_torch_access(user: User) -> None:
    """Та же видимость, что у пункта меню/раздела «Факел» целиком."""
    if user.role != "admin" and user.graduated_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available")


@router.get("/stub", response_model=TorchStubOut)
async def get_torch_stub(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TorchStubOut:
    """Текст заглушки для закрытого клуба — та же видимость, что у пункта меню."""
    _require_torch_access(current_user)
    settings = await get_or_create_torch_settings(session)
    # Свой текст потока (ARG-169) перекрывает общий.
    intake_text = (
        await session.scalar(
            select(Intake.torch_stub_text).where(Intake.id == current_user.intake_id)
        )
        if current_user.intake_id is not None
        else None
    )
    return TorchStubOut(
        stub_text=intake_text or settings.stub_text, apply_admin_id=settings.admin_user_id
    )


@router.post("/apply", response_model=TorchApplyOut)
async def apply_to_torch(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TorchApplyOut:
    """Кнопка «Подать заявку» на гейте (ARG-158): открыть/создать `torch_scope`
    DM с назначенным админом Факела и отметить пользователя как подавшего
    заявку. Обходит self-service проверку `torch=true` в `POST /api/rooms`
    (та требует уже открытого тумблера) — именно для того, чтобы дать написать
    ДО тумблера, это весь смысл кнопки. `torch_scope=true` обязателен: обычный
    DM был бы недоступен для записи выпускнику (см. assert_can_write)."""
    _require_torch_access(current_user)
    settings = await get_or_create_torch_settings(session)
    if settings.admin_user_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Torch admin not configured")
    room, _created = await get_or_create_dm(
        session, current_user, settings.admin_user_id, torch=True
    )
    if current_user.torch_applied_at is None:
        current_user.torch_applied_at = datetime.now(UTC)
    await session.flush()
    return TorchApplyOut(room_id=room.id)


@router.get("/contacts", response_model=list[PublicUserOut])
async def list_torch_contacts(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PublicUserOut]:
    """Контакты для «начать чат»/«группа» ВНУТРИ «Факела» (ARG-54, часть 2):
    любой другой член клуба (`torch_unlocked`) + любой админ — без рангового
    каскада тарифов (`contact_visible`/`cohort_plan_ranks`, тот вообще не при
    делах после выпуска). Доступен только тем, кто сам видит раздел (выпустился
    или админ) — не обязательно уже открытому тумблером: смотреть, с кем можно
    будет говорить, когда откроют, не запрещено.
    """
    _require_torch_access(current_user)
    candidates = (
        await session.execute(
            select(User).where(
                User.id != current_user.id,
                (User.role == "admin") | (User.torch_unlocked.is_(True)),
            )
        )
    ).scalars().all()
    # Админы — блоком после участников клуба, тем же порядком, что и обычный
    # контакт-лист (см. list_contacts, app/api/users.py) — привычная раскладка.
    candidates.sort(key=lambda u: (u.role == "admin", u.display_name))
    media_ids = {u.avatar_media_id for u in candidates if u.avatar_media_id is not None}
    signed = await presign_asset_urls(session, media_ids)
    return [
        PublicUserOut(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            avatar_url=avatar_url(u, signed),
            bio=u.bio,
            role=u.role,
            plan_id=None,
            plan_name=None,
        )
        for u in candidates
    ]


def _require_torch_member(user: User) -> None:
    """Строго член клуба (`torch_unlocked=true`) — БЕЗ исключения для админа,
    в отличие от `_require_torch_access` выше (тот пускает и админа без
    выпуска). Посты стены — контент конкретного члена клуба, писать/читать их
    может только тот, кто сам прошёл гейт (ARG-155/164); модерация (удаление
    чужого поста) — отдельный, более широкий, путь ниже в `delete_torch_post`."""
    if not user.torch_unlocked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not available")


@router.post(
    "/posts", response_model=TorchPostOut, status_code=status.HTTP_201_CREATED
)
async def create_torch_post(
    body: TorchPostCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TorchPostOut:
    """Пост пишется на СВОЮ стену — `author_id` всегда `current_user.id`, из
    тела запроса не принимается (IDOR: автора нельзя подделать)."""
    _require_torch_member(current_user)
    post = TorchPost(author_id=current_user.id, body=body.body)
    session.add(post)
    await session.flush()
    await session.refresh(post)
    return TorchPostOut(
        id=post.id,
        author_id=post.author_id,
        author_display_name=current_user.display_name,
        body=post.body,
        created_at=post.created_at,
    )


@router.get("/posts", response_model=list[TorchPostOut])
async def list_torch_posts(
    user_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TorchPostOut]:
    """Лента постов КОНКРЕТНОГО профиля (`user_id`), не общая лента клуба (см.
    Assumptions ARG-155/164) — новые сверху. Целевой `user_id` не обязан сам
    быть членом клуба формально: раз писать посты мог только член, у не-члена
    их физически нет, отдельной проверки/404 на него не делаем."""
    _require_torch_member(current_user)
    rows = (
        await session.execute(
            select(TorchPost, User.display_name)
            .join(User, User.id == TorchPost.author_id)
            .where(TorchPost.author_id == user_id, TorchPost.deleted_at.is_(None))
            .order_by(TorchPost.created_at.desc())
        )
    ).all()
    return [
        TorchPostOut(
            id=post.id,
            author_id=post.author_id,
            author_display_name=display_name,
            body=post.body,
            created_at=post.created_at,
        )
        for post, display_name in rows
    ]


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_torch_post(
    post_id: int,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Автор поста ИЛИ админ — шире, чем `_require_torch_member` выше: модерация
    (админ) должна работать независимо от собственного `torch_unlocked` админа,
    тот же принцип "оверсайт сильнее гейта", что и везде в проекте. Soft-delete
    (`deleted_at`), не hard — общее правило CLAUDE.md (Cabin — единственное
    исключение, это не она)."""
    post = await session.get(TorchPost, post_id)
    if post is None or post.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found")
    if post.author_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Not allowed to delete this post"
        )
    post.deleted_at = datetime.now(UTC)
    await session.flush()
