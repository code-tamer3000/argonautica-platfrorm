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
from app.models.user import User
from app.schemas.torch import TorchApplyOut, TorchStubOut
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
    return TorchStubOut(stub_text=settings.stub_text, apply_admin_id=settings.admin_user_id)


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
