"""Админские эндпоинты. Платформа закрытая — пользователей заводит только админ."""
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, exists, func, select, union, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.selectable import CompoundSelect

from app.api.deps import get_current_active_user, require_admin
from app.api.dynamics import credit_day, get_all_dynamics, uncredit_day
from app.core.security import generate_one_time_password, hash_password
from app.db.session import get_session
from app.models.calendar import CalendarEvent
from app.models.feedback import Feedback
from app.models.kb import KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.room import Room, RoomMember
from app.models.sticker import Sticker, Stickerpack
from app.models.user import User
from app.schemas.feedback import (
    FeedbackListOut,
    FeedbackOut,
    FeedbackResolveRequest,
)
from app.schemas.journal import AdminCreditRequest, AdminDynamicsOut
from app.schemas.user import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    AdminUpdateUserRequest,
    AdminUserOut,
    UserOut,
)
from app.services.notifications import notify_cabin_granted

# Поля, которые админу разрешено править через PATCH. Расширяется добавлением имени
# сюда и поля в AdminUpdateUserRequest (напр. будущие role/is_banned).
_PATCHABLE_FIELDS = {"can_create_groups", "can_access_cabin", "role"}

# Весь роутер под require_admin — каждый запрос проверяет роль на сервере (п.1).
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[User]:
    """Список пользователей с admin-полями (включая can_create_groups)."""
    result = await session.execute(select(User).order_by(User.display_name))
    return list(result.scalars().all())


@router.post(
    "/users",
    response_model=AdminCreateUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    body: AdminCreateUserRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AdminCreateUserResponse:
    """Создать юзера. Сервер генерит одноразовый пароль и отдаёт его ОДИН раз."""
    one_time_password = generate_one_time_password()
    user = User(
        username=body.username,
        display_name=body.display_name,
        email=body.email,
        role=body.role,
        password_hash=hash_password(one_time_password),
        must_change_password=True,
    )
    session.add(user)
    try:
        await session.flush()  # получаем id и ловим конфликт уникальности
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username or email already exists",
        ) from exc
    # Auto-create personal channel for new user.
    personal_channel = Room(
        type="channel",
        name=user.display_name,
        is_personal=True,
        created_by=user.id,
    )
    session.add(personal_channel)
    await session.flush()

    return AdminCreateUserResponse(
        id=user.id,
        username=user.username,
        one_time_password=one_time_password,
    )


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: AdminUpdateUserRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    """Частичное обновление юзера: применяем только переданные whitelisted-поля."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    changes = body.model_dump(exclude_unset=True)
    # Переход «доступ к Каюте закрыт → открыт» — повод уведомить участника (после flush).
    grant_cabin = changes.get("can_access_cabin") is True and not user.can_access_cabin
    for field, value in changes.items():
        if field in _PATCHABLE_FIELDS:
            setattr(user, field, value)
    if changes:
        user.updated_at = datetime.now(UTC)
    await session.flush()
    if grant_cabin:
        await notify_cabin_granted(session, user.id)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    admin: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Полностью удалить пользователя и его личный след.

    Отказываемся удалять, если юзер владеет ДОЛГОИГРАЮЩИМ/ОБЩИМ контентом (статьи БЗ,
    стикерпаки, события календаря, группы/каналы) — такое нельзя молча стереть, оно
    видно другим. Личный след (членства, состояние прочтения, закрепы, свои сообщения,
    личный канал, DM с любым собеседником) удаляем каскадно в одной транзакции — DM
    двусторонний и без одного из двух участников теряет смысл, поэтому блокером не
    считается.

    Рассчитано на удаление служебных/тестовых учёток. Роутер уже под require_admin.
    """
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить самого себя")

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    # Долгоиграющий контент блокирует удаление — иначе он «повиснет» или исчезнет у всех.
    blockers: list[str] = []
    if await session.scalar(select(exists().where(KbItem.created_by == user_id))):
        blockers.append("статьи базы знаний")
    if await session.scalar(select(exists().where(Stickerpack.created_by == user_id))):
        blockers.append("стикерпаки")
    if await session.scalar(select(exists().where(CalendarEvent.created_by == user_id))):
        blockers.append("события календаря")
    # Группы/каналы, созданные юзером (не личный канал и не dm — те удалим вместе с ним).
    shared_rooms = await session.scalar(
        select(
            exists().where(
                Room.created_by == user_id,
                Room.is_personal.is_(False),
                Room.type != "dm",
            )
        )
    )
    if shared_rooms:
        blockers.append("группы/каналы")
    if blockers:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Нельзя удалить: пользователь владеет контентом ({', '.join(blockers)}). "
            "Сначала переназначьте или удалите его.",
        )

    # Личный канал юзера (is_personal) удаляем вместе с ним; собираем его id.
    personal_room_ids = list(
        (
            await session.execute(
                select(Room.id).where(
                    Room.created_by == user_id, Room.is_personal.is_(True)
                )
            )
        )
        .scalars()
        .all()
    )
    # DM юзера — по членству, а не created_by (собеседник мог быть создателем).
    dm_room_ids = list(
        (
            await session.execute(
                select(Room.id)
                .join(RoomMember, RoomMember.room_id == Room.id)
                .where(Room.type == "dm", RoomMember.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    room_ids_to_drop = personal_room_ids + dm_room_ids

    # id сообщений юзера — нужны, чтобы снять ссылки на них перед удалением.
    msg_ids = list(
        (await session.execute(select(Message.id).where(Message.sender_id == user_id)))
        .scalars()
        .all()
    )

    # Снять FK-ссылки на сообщения удаляемого юзера (закрепы, last_read, вложения, треды).
    if msg_ids:
        await session.execute(
            delete(PinnedMessage).where(PinnedMessage.message_id.in_(msg_ids))
        )
        await session.execute(
            delete(MessageAttachment).where(MessageAttachment.message_id.in_(msg_ids))
        )
        await session.execute(
            update(RoomMember)
            .where(RoomMember.last_read_message_id.in_(msg_ids))
            .values(last_read_message_id=None)
        )
        # Ответы в тредах на корни этого юзера — «отвязываем» (правило плоскости тредов).
        await session.execute(
            update(Message)
            .where(Message.thread_root_id.in_(msg_ids))
            .values(thread_root_id=None)
        )
        await session.execute(delete(Message).where(Message.sender_id == user_id))

    # Закрепы, сделанные юзером, и его членства/состояние чтения.
    await session.execute(delete(PinnedMessage).where(PinnedMessage.pinned_by == user_id))
    await session.execute(delete(RoomMember).where(RoomMember.user_id == user_id))

    # Личный канал и dm юзера: их сообщения, закрепы, членства и сами комнаты.
    if room_ids_to_drop:
        room_msg_ids = list(
            (
                await session.execute(
                    select(Message.id).where(Message.room_id.in_(room_ids_to_drop))
                )
            )
            .scalars()
            .all()
        )
        if room_msg_ids:
            await session.execute(
                delete(MessageAttachment).where(
                    MessageAttachment.message_id.in_(room_msg_ids)
                )
            )
            await session.execute(
                delete(PinnedMessage).where(PinnedMessage.message_id.in_(room_msg_ids))
            )
        await session.execute(
            delete(PinnedMessage).where(PinnedMessage.room_id.in_(room_ids_to_drop))
        )
        await session.execute(
            delete(RoomMember).where(RoomMember.room_id.in_(room_ids_to_drop))
        )
        await session.execute(
            delete(Message).where(Message.room_id.in_(room_ids_to_drop))
        )
        await session.execute(delete(Room).where(Room.id.in_(room_ids_to_drop)))

    # Медиа, загруженные юзером. Снимаем его аватар (media_assets.created_by NOT NULL,
    # обнулить нельзя — только удалить актив). Удаляем лишь те активы, что больше
    # НИКЕМ не используются: оставшиеся FK-ссылки (чужие сообщения/БЗ/стикеры) —
    # защитная сеть, которая корректно откатит транзакцию, если что-то ещё висит.
    user.avatar_media_id = None
    await session.flush()
    referenced: CompoundSelect[tuple[Any]] = union(
        select(MessageAttachment.media_asset_id),
        select(KbItemMedia.media_asset_id),
        select(Sticker.image_media_id).where(Sticker.image_media_id.isnot(None)),
        select(User.avatar_media_id).where(User.avatar_media_id.isnot(None)),
    )
    await session.execute(
        delete(MediaAsset).where(
            MediaAsset.created_by == user_id,
            MediaAsset.id.notin_(referenced.scalar_subquery()),
        )
    )

    await session.delete(user)
    await session.flush()


@router.get("/dynamics", response_model=AdminDynamicsOut)
async def admin_dynamics(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AdminDynamicsOut:
    """Сводка + динамика ДЗ всех участников для администратора."""
    return await get_all_dynamics(session)


@router.post("/dynamics/credit", response_model=AdminDynamicsOut)
async def admin_credit_day(
    body: AdminCreditRequest,
    admin: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AdminDynamicsOut:
    """Вручную зачесть (или снять зачёт) день пользователю. Возвращает свежую динамику."""
    if body.credited:
        await credit_day(session, body.user_id, body.date, granted_by=admin.id)
    else:
        await uncredit_day(session, body.user_id, body.date)
    return await get_all_dynamics(session)


@router.get("/feedback", response_model=FeedbackListOut)
async def list_feedback(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FeedbackListOut:
    """Все обращения из раздела «Поддержка»: сначала новые. + счётчик неразобранных."""
    rows = (
        await session.execute(
            select(Feedback, User.display_name)
            .outerjoin(User, User.id == Feedback.user_id)
            .order_by(Feedback.id.desc())
        )
    ).all()
    items = [
        FeedbackOut(
            id=f.id,
            kind=f.kind,
            body=f.body,
            user_id=f.user_id,
            user_name=user_name,
            created_at=f.created_at,
            resolved_at=f.resolved_at,
        )
        for f, user_name in rows
    ]
    unresolved = (
        await session.execute(
            select(func.count())
            .select_from(Feedback)
            .where(Feedback.resolved_at.is_(None))
        )
    ).scalar_one()
    return FeedbackListOut(items=items, unresolved_count=unresolved)


@router.patch("/feedback/{feedback_id}", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_feedback(
    feedback_id: int,
    body: FeedbackResolveRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Отметить обращение разобранным (resolved=True) или вернуть в работу."""
    fb = await session.get(Feedback, feedback_id)
    if fb is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found"
        )
    fb.resolved_at = datetime.now(UTC) if body.resolved else None
    await session.flush()
