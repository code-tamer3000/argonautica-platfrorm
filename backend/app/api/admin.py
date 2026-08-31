"""Админские эндпоинты. Платформа закрытая — пользователей заводит только админ."""
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, exists, func, or_, select, union, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.selectable import CompoundSelect

from app.api.deps import get_current_active_user, require_admin
from app.api.dynamics import (
    create_program,
    credit_day,
    delete_program,
    get_all_dynamics,
    list_programs,
    uncredit_day,
    update_program,
)
from app.core.security import generate_one_time_password, hash_password
from app.db.session import get_session
from app.models.calendar import CalendarEvent
from app.models.expedition import STAGE_KINDS, IntakeStage
from app.models.feedback import Feedback
from app.models.intake import Intake
from app.models.kb import KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message, MessageAttachment, PinnedMessage
from app.models.plan import Plan
from app.models.push import PushSubscription
from app.models.room import Room, RoomMember
from app.models.sticker import Sticker, Stickerpack
from app.models.survey import SurveyResponse
from app.models.task import TaskAssignment, TaskComment, TaskSubmission, TaskSubmissionMedia
from app.models.user import User
from app.schemas.expedition import StageOut, StagesUpdate
from app.schemas.feedback import (
    FeedbackListOut,
    FeedbackOut,
    FeedbackResolveRequest,
)
from app.schemas.intake import IntakeCreateRequest, IntakeOut, IntakeUpdateRequest
from app.schemas.journal import (
    AdminCreditRequest,
    AdminDynamicsOut,
    JournalProgramIn,
    JournalProgramOut,
    JournalProgramUpdate,
)
from app.schemas.plan import PlanCreateRequest, PlanOut, PlanUpdateRequest
from app.schemas.push import (
    AdminBroadcastRequest,
    NotifPrefsOverviewOut,
    UserNotifPrefsOut,
)
from app.schemas.survey import (
    SurveyGiftRequest,
    SurveyInviteRequest,
    SurveyOverviewOut,
    SurveyRowOut,
)
from app.schemas.user import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    AdminUpdateUserRequest,
    AdminUserOut,
    UserOut,
)
from app.services.notifications import broadcast_admin, notify_cabin_granted
from app.services.notify_prefs import resolved_prefs
from app.services.survey_form import question_form

# Поля, которые админу разрешено править через PATCH. Расширяется добавлением имени
# сюда и поля в AdminUpdateUserRequest (напр. будущие role/is_banned).
_PATCHABLE_FIELDS = {
    "can_create_groups",
    "can_access_cabin",
    "is_observer",
    "is_navigator",
    "role",
    "intake_id",
}

# Весь роутер под require_admin — каждый запрос проверяет роль на сервере (п.1).
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/intakes", response_model=list[IntakeOut])
async def list_intakes(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[IntakeOut]:
    """Наборы, свежие сверху. Первый в списке — активный (максимальная starts_on).

    `user_count` считаем здесь, чтобы админка показывала и пустые наборы (только что
    созданный набор ещё никого не содержит, но выбрать его при заведении юзера надо).
    """
    counts = (
        select(User.intake_id.label("intake_id"), func.count().label("cnt"))
        .where(User.intake_id.is_not(None))
        .group_by(User.intake_id)
        .subquery()
    )
    rows = await session.execute(
        select(Intake, func.coalesce(counts.c.cnt, 0))
        .outerjoin(counts, counts.c.intake_id == Intake.id)
        .order_by(Intake.starts_on.desc())
    )
    return [
        IntakeOut(
            id=intake.id,
            starts_on=intake.starts_on,
            ends_on=intake.ends_on,
            created_at=intake.created_at,
            user_count=user_count,
        )
        for intake, user_count in rows.all()
    ]


@router.post("/intakes", response_model=IntakeOut, status_code=status.HTTP_201_CREATED)
async def create_intake(
    body: IntakeCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> IntakeOut:
    """Создать набор. Дата старта уникальна — два набора в один день бессмысленны."""
    intake = Intake(starts_on=body.starts_on, ends_on=body.ends_on)
    session.add(intake)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Набор с такой датой старта уже существует",
        ) from exc
    await session.refresh(intake)  # created_at приходит из server_default
    return IntakeOut(
        id=intake.id,
        starts_on=intake.starts_on,
        ends_on=intake.ends_on,
        created_at=intake.created_at,
        user_count=0,
    )


@router.patch("/intakes/{intake_id}", response_model=IntakeOut)
async def update_intake(
    intake_id: int,
    body: IntakeUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> IntakeOut:
    """Подвинуть дату закрытия набора (`starts_on` без API — см. ARG-89)."""
    intake = await session.get(Intake, intake_id)
    if intake is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Набор не найден")
    if body.ends_on <= intake.starts_on:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Дата закрытия должна быть позже даты старта"
        )
    intake.ends_on = body.ends_on
    await session.flush()
    user_count = (
        await session.scalar(
            select(func.count()).select_from(User).where(User.intake_id == intake.id)
        )
    ) or 0
    return IntakeOut(
        id=intake.id,
        starts_on=intake.starts_on,
        ends_on=intake.ends_on,
        created_at=intake.created_at,
        user_count=user_count,
    )


@router.get("/intakes/{intake_id}/stages", response_model=list[StageOut])
async def get_intake_stages(
    intake_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[IntakeStage]:
    """Расписание Круга Экспедиции потока. Пустой список — не заведено: фронт/агрегат
    дашборда падает на равные четверти (см. app/services/expedition.fallback_stages)."""
    if await session.get(Intake, intake_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Набор не найден")
    rows = await session.execute(
        select(IntakeStage).where(IntakeStage.intake_id == intake_id)
    )
    by_kind = {s.kind: s for s in rows.scalars().all()}
    return [by_kind[k] for k in STAGE_KINDS if k in by_kind]


@router.put("/intakes/{intake_id}/stages", response_model=list[StageOut])
async def set_intake_stages(
    intake_id: int,
    body: StagesUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[IntakeStage]:
    """Заменяет расписание целиком — фиксированные шесть этапов, частичный PATCH
    только плодил бы несогласованные графики (пропущенный этап посреди круга)."""
    if await session.get(Intake, intake_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Набор не найден")

    kinds = [s.kind for s in body.stages]
    if set(kinds) != set(STAGE_KINDS):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Нужны все шесть этапов, каждый ровно один раз"
        )
    order_index = {k: i for i, k in enumerate(STAGE_KINDS)}
    ordered = sorted(body.stages, key=lambda s: order_index[s.kind])
    for prev, nxt in zip(ordered, ordered[1:], strict=False):
        if nxt.air_date <= prev.air_date:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Эфир «{nxt.kind}» должен быть позже эфира «{prev.kind}»",
            )

    await session.execute(delete(IntakeStage).where(IntakeStage.intake_id == intake_id))
    rows = [
        IntakeStage(
            intake_id=intake_id,
            kind=s.kind,
            air_date=s.air_date,
            air_time=s.air_time,
            task_id=s.task_id,
        )
        for s in ordered
    ]
    session.add_all(rows)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Одно из заданий не существует"
        ) from exc
    return rows


@router.get("/plans", response_model=list[PlanOut])
async def list_plans(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[Plan]:
    """Все тарифы (включая неактивные — админ должен видеть их, чтобы включить обратно)."""
    stmt = select(Plan).order_by(Plan.price)
    return list((await session.execute(stmt)).scalars().all())


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
async def create_plan(
    body: PlanCreateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Plan:
    """Создать тариф. Бот-воронка (ARG-92) читает активные тарифы напрямую из БД."""
    plan = Plan(
        name=body.name,
        price=body.price,
        description=body.description,
        is_active=body.is_active,
    )
    session.add(plan)
    await session.flush()
    await session.refresh(plan)
    return plan


@router.patch("/plans/{plan_id}", response_model=PlanOut)
async def update_plan(
    plan_id: int,
    body: PlanUpdateRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Plan:
    """Частичное обновление тарифа — цена/название меняются без редеплоя бота."""
    plan = await session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тариф не найден")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    await session.flush()
    await session.refresh(plan)
    return plan


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plan(
    plan_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Удалить тариф. 409, если на него ещё ссылаются участники/заявки.

    В этом случае деактивируй тариф вместо удаления.
    """
    plan = await session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Тариф не найден")
    await session.delete(plan)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Тариф уже выбран участником — деактивируй вместо удаления",
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    session: Annotated[AsyncSession, Depends(get_session)],
    intake_id: Annotated[int | None, Query()] = None,
) -> list[AdminUserOut]:
    """Список пользователей с admin-полями. `intake_id` фильтрует по набору.

    Дату старта набора и имя тарифа отдаём рядом с юзером, чтобы админка
    группировала/подписывала список, не сопоставляя его со вторым запросом на
    клиенте (тот же приём, что и с intake_starts_on).
    """
    stmt = (
        select(User, Intake.starts_on, Plan.name)
        .outerjoin(Intake, Intake.id == User.intake_id)
        .outerjoin(Plan, Plan.id == User.plan_id)
        .order_by(User.display_name)
    )
    if intake_id is not None:
        stmt = stmt.where(User.intake_id == intake_id)
    rows = await session.execute(stmt)
    return [
        AdminUserOut.model_validate(user).model_copy(
            update={"intake_starts_on": starts_on, "plan_name": plan_name}
        )
        for user, starts_on, plan_name in rows.all()
    ]


@router.post(
    "/users",
    response_model=AdminCreateUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    body: AdminCreateUserRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AdminCreateUserResponse:
    """Создать юзера. Сервер генерит одноразовый пароль и отдаёт его ОДИН раз.

    Набор обязателен: от его `starts_on` считается окно Динамики участника.
    """
    if await session.get(Intake, body.intake_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Набор не найден")
    if body.plan_id is not None and await session.get(Plan, body.plan_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Тариф не найден")
    one_time_password = generate_one_time_password()
    user = User(
        username=body.username,
        display_name=body.display_name,
        email=body.email,
        role=body.role,
        intake_id=body.intake_id,
        plan_id=body.plan_id,
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
    # Наблюдатель и админ взаимоисключаемы: у админа полный доступ, наблюдатель —
    # пассивный. Итоговое (с учётом переданных полей) состояние не должно быть «и то, и то».
    # Перевод в другой набор двигает окно Динамики — набор обязан существовать.
    # Отвязать участника от набора через PATCH нельзя: набор обязателен (см. create_user).
    if "intake_id" in changes:
        new_intake_id = changes["intake_id"]
        if new_intake_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Участника нельзя оставить без набора"
            )
        if await session.get(Intake, new_intake_id) is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Набор не найден")
    final_role = changes.get("role", user.role)
    final_observer = changes.get("is_observer", user.is_observer)
    if final_role == "admin" and final_observer:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Админ не может быть наблюдателем — это взаимоисключающие режимы",
        )
    # Навигатор (ARG-110) имеет смысл только у admin — по образцу is_observer выше.
    final_navigator = changes.get("is_navigator", user.is_navigator)
    if final_role != "admin" and final_navigator:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Навигатором может быть только админ",
        )
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

    # Задачи: свои назначения/сдачи — личный след, как и сообщения выше (не блокер:
    # ARG-92 intake-бот теперь назначает individual-задания автоматически при
    # регистрации, поэтому у любого свежесозданного юзера уже есть task_assignments
    # к моменту, когда /reset может его удалить — без этой чистки FK на
    # task_assignments/task_submissions роняет транзакцию). Комментарии под сдачей
    # могли оставить и другие (ревью админа) — снимаем их тоже, иначе повиснет FK
    # на уже удаляемую сдачу; свои комментарии под ЧУЖИМИ сдачами удаляем отдельно.
    own_assignment_ids = list(
        (
            await session.execute(
                select(TaskAssignment.id).where(TaskAssignment.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    own_submission_ids = (
        list(
            (
                await session.execute(
                    select(TaskSubmission.id).where(
                        TaskSubmission.assignment_id.in_(own_assignment_ids)
                    )
                )
            )
            .scalars()
            .all()
        )
        if own_assignment_ids
        else []
    )
    await session.execute(
        delete(TaskComment).where(
            or_(
                TaskComment.author_id == user_id,
                TaskComment.submission_id.in_(own_submission_ids),
            )
        )
    )
    if own_submission_ids:
        await session.execute(
            delete(TaskSubmissionMedia).where(
                TaskSubmissionMedia.submission_id.in_(own_submission_ids)
            )
        )
        await session.execute(
            delete(TaskSubmission).where(TaskSubmission.id.in_(own_submission_ids))
        )
    await session.execute(delete(TaskAssignment).where(TaskAssignment.user_id == user_id))

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
    intake_id: Annotated[list[int] | None, Query()] = None,
) -> AdminDynamicsOut:
    """Сводка + динамика ДЗ участников. `intake_id` (можно несколько) режет по набору(ам).

    Без параметра — все наборы сразу. Сводные счётчики считаются по той же выборке,
    что и список: фильтр по набору меняет и её.
    """
    return await get_all_dynamics(session, intake_id)


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


# ─── Структура дневника (задания) ───────────────────────────────────────────

@router.get("/journal/programs", response_model=list[JournalProgramOut])
async def admin_list_programs(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[JournalProgramOut]:
    """Все задания дневника с разделами (по возрастанию даты старта)."""
    return await list_programs(session)


@router.post("/journal/programs", response_model=JournalProgramOut, status_code=201)
async def admin_create_program(
    body: JournalProgramIn,
    admin: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> JournalProgramOut:
    """Создать новое задание (версию структуры), действующее с `starts_on`."""
    return await create_program(session, body, created_by=admin.id)


@router.patch("/journal/programs/{program_id}", response_model=JournalProgramOut)
async def admin_update_program(
    program_id: int,
    body: JournalProgramUpdate,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> JournalProgramOut:
    """Изменить задание. Замена набора разделов у прошлого/активного задания
    пересчитает те дни — фронтенд предупреждает об этом."""
    return await update_program(session, program_id, body)


@router.delete("/journal/programs/{program_id}", status_code=204)
async def admin_delete_program(
    program_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Удалить задание (кроме самого раннего)."""
    await delete_program(session, program_id)


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


@router.post(
    "/notifications/broadcast", status_code=status.HTTP_202_ACCEPTED
)
async def broadcast_notification(
    body: AdminBroadcastRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, int]:
    """Разослать уведомление всем пользователям (in-app лента + native push).

    Push уходит только тем, у кого включён тумблер `admin`; in-app-строку в ленте
    получают все. Возвращает число адресатов.
    """
    recipients = await broadcast_admin(session, body.title.strip(), body.body.strip())
    return {"recipients": recipients}


@router.get("/notifications/prefs", response_model=NotifPrefsOverviewOut)
async def notification_prefs_overview(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> NotifPrefsOverviewOut:
    """Обзор «у кого включены уведомления»: настройки + число устройств на юзера."""
    users = (
        await session.execute(
            select(User.id, User.display_name, User.settings).order_by(
                User.display_name
            )
        )
    ).all()

    # Число активных push-подписок на пользователя (одним запросом).
    device_rows = (
        await session.execute(
            select(PushSubscription.user_id, func.count())
            .select_from(PushSubscription)
            .group_by(PushSubscription.user_id)
        )
    ).all()
    devices_by_uid = {uid: cnt for uid, cnt in device_rows}

    items = []
    for uid, display_name, user_settings in users:
        prefs = resolved_prefs(user_settings)
        items.append(
            UserNotifPrefsOut(
                user_id=uid,
                display_name=display_name,
                push_enabled=prefs["push_enabled"],
                dm=prefs["dm"],
                reply=prefs["reply"],
                news=prefs["news"],
                mention=prefs["mention"],
                admin=prefs["admin"],
                devices=devices_by_uid.get(uid, 0),
            )
        )
    return NotifPrefsOverviewOut(items=items)


# --- выпускная анкета экспедиции ---------------------------------------


@router.get("/survey", response_model=SurveyOverviewOut)
async def survey_overview(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SurveyOverviewOut:
    """Кому показана анкета, кто её сдал и что ответил — одной таблицей.

    Форму отдаём вместе со строками: админка подписывает ответы по канону, а не
    по своей копии вопросов.
    """
    rows = (
        await session.execute(
            select(User, SurveyResponse)
            .outerjoin(SurveyResponse, SurveyResponse.user_id == User.id)
            .where(User.role != "admin")
            .order_by(User.display_name)
        )
    ).all()

    items = [
        SurveyRowOut(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            invited=user.survey_required or response is not None,
            completed_at=response.created_at if response else None,
            publish_consent=bool(response and response.publish_consent),
            has_gift=user.survey_gift_asset_id is not None,
            gift_asset_id=user.survey_gift_asset_id,
            answers=response.answers if response else None,
            version=response.version if response else None,
        )
        for user, response in rows
    ]
    return SurveyOverviewOut(
        form=question_form(),
        rows=items,
        invited_count=sum(1 for i in items if i.invited),
        completed_count=sum(1 for i in items if i.completed_at is not None),
    )


@router.post("/survey/invite", status_code=status.HTTP_204_NO_CONTENT)
async def invite_to_survey(
    body: SurveyInviteRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Показать анкету перечисленным участникам — платформа для них закрывается.

    Тем, кто анкету уже сдал, флаг не поднимаем: сдавать её можно один раз, иначе
    человек упрётся в 409 и останется заперт.
    """
    already_done = (
        (
            await session.execute(
                select(SurveyResponse.user_id).where(
                    SurveyResponse.user_id.in_(body.user_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    targets = set(body.user_ids) - set(already_done)
    if not targets:
        return
    await session.execute(
        update(User)
        .where(User.id.in_(targets), User.role != "admin")
        .values(survey_required=True)
    )
    await session.flush()


@router.delete("/survey/invite/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_survey_invite(
    user_id: int,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Снять блокировку с человека, не дожидаясь анкеты."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.survey_required = False
    await session.flush()


@router.patch("/survey/gift/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def set_survey_gift(
    user_id: int,
    body: SurveyGiftRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Привязать участнику его личную книгу (media_asset_id) или отвязать (null)."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if body.media_asset_id is not None:
        asset = await session.get(MediaAsset, body.media_asset_id)
        if asset is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Media asset not found")
    user.survey_gift_asset_id = body.media_asset_id
    await session.flush()
