"""Круг Экспедиции — замки-гексаграммы участника.

Четыре слота (по стихии), закреплённые за пользователем навсегда: ввод —
идемпотентный upsert, не бросок (правится, если человек ошибся). Доступен и
выпускнику, и участнику с закрытым окном набора («смысл добирают и после
финиша») — поэтому за `require_participant`, а не `require_ongoing_participant`
(тот дополнительно блокирует выпускника, здесь это не нужно).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, require_participant
from app.db.session import get_session
from app.models.expedition import ELEMENTS, ExpeditionLock, IntakeStage
from app.models.intake import Intake
from app.models.task import TaskAssignment
from app.models.user import User
from app.schemas.expedition import Element, LockIn, LockOut
from app.services.expedition import (
    StageSpan,
    fallback_stages,
    hexagram_for,
    layout_stages,
    lock_state,
    unlock_moment,
)

router = APIRouter(
    prefix="/api/expedition",
    tags=["expedition"],
    dependencies=[Depends(require_participant)],
)


async def get_stage_spans(session: AsyncSession, intake_id: int | None) -> list[StageSpan]:
    """Расписание потока, разложенное по дням круга. Пустой список — нет потока
    (`intake_id is None`) или набор не найден; иначе фолбэк на равные четверти,
    если админка ещё не завела `intake_stages` (см. services.expedition)."""
    if intake_id is None:
        return []
    intake_starts_on = await session.scalar(select(Intake.starts_on).where(Intake.id == intake_id))
    if intake_starts_on is None:
        return []
    rows = await session.execute(select(IntakeStage).where(IntakeStage.intake_id == intake_id))
    stages = list(rows.scalars().all())
    return layout_stages(stages, intake_starts_on) if stages else fallback_stages(intake_starts_on)


def stage_by_kind(spans: list[StageSpan], kind: str) -> StageSpan | None:
    return next((s for s in spans if s.kind == kind), None)


@router.get("/locks", response_model=list[LockOut])
async def list_locks(
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ExpeditionLock]:
    rows = await session.execute(
        select(ExpeditionLock).where(ExpeditionLock.user_id == current_user.id)
    )
    return list(rows.scalars().all())


@router.put("/locks/{element}", response_model=LockOut)
async def set_lock(
    element: Element,
    body: LockIn,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> LockOut:
    if element not in ELEMENTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown element")

    spans = await get_stage_spans(session, current_user.intake_id)
    stage = stage_by_kind(spans, element)
    if stage is None or datetime.now(UTC) < unlock_moment(stage):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Замок этой стихии ещё не открыт — эфир не прошёл"
        )

    hexagram = hexagram_for(body.key_number)
    stmt = (
        pg_insert(ExpeditionLock)
        .values(
            user_id=current_user.id,
            element=element,
            key_number=body.key_number,
            hexagram=hexagram,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "element"],
            set_={"key_number": body.key_number, "hexagram": hexagram},
        )
        .returning(ExpeditionLock)
    )
    lock = (await session.execute(stmt)).scalar_one()
    await session.flush()
    return LockOut.model_validate(lock)


async def lock_states_for(
    session: AsyncSession, current_user: User, spans: list[StageSpan]
) -> tuple[dict[str, LockOut], dict[str, str]]:
    """Замки участника + их состояния для уже загруженного расписания —
    переиспользуется дашбордом (app/api/dashboard.py), которому spans нужны
    и для самого круга, так что расписание грузится один раз, не дважды."""
    locks_rows = await session.execute(
        select(ExpeditionLock).where(ExpeditionLock.user_id == current_user.id)
    )
    locks = {lock.element: lock for lock in locks_rows.scalars().all()}
    locks_out = {el: LockOut.model_validate(lock) for el, lock in locks.items()}

    states: dict[str, str] = {}
    for element in ELEMENTS:
        span = stage_by_kind(spans, element)
        task_status = None
        if span is not None and span.task_id is not None:
            task_status = await session.scalar(
                select(TaskAssignment.status).where(
                    TaskAssignment.task_id == span.task_id,
                    TaskAssignment.user_id == current_user.id,
                )
            )
        states[element] = lock_state(span, locks.get(element), task_status)
    return locks_out, states
