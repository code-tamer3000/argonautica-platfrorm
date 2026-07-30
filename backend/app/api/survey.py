"""Выпускная анкета экспедиции: форма, отправка, подарок.

Все эндпоинты сидят на `get_current_user`, а НЕ на `get_current_active_user` —
иначе они бы отбивались тем самым гейтом, который сами и снимают (тот же приём,
что у смены пароля: `app/api/auth.py`).
"""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_session
from app.models.media import MediaAsset
from app.models.survey import SurveyResponse
from app.models.user import User
from app.schemas.survey import SurveyFormOut, SurveyGiftOut, SurveySubmit
from app.services.media import PRESIGN_GET_EXPIRES, presigned_get_url
from app.services.survey_form import (
    SURVEY_VERSION,
    question_form,
    validate_answers,
)

router = APIRouter(prefix="/api/survey", tags=["survey"])


async def _response_of(session: AsyncSession, user_id: int) -> SurveyResponse | None:
    return (
        await session.execute(
            select(SurveyResponse).where(SurveyResponse.user_id == user_id)
        )
    ).scalar_one_or_none()


@router.get("/me", response_model=SurveyFormOut)
async def get_survey_form(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SurveyFormOut:
    """Форма + состояние текущего пользователя по ней."""
    existing = await _response_of(session, current_user.id)
    return SurveyFormOut(
        **question_form(),
        completed_at=existing.created_at if existing else None,
        required=current_user.survey_required,
        gift_available=current_user.survey_gift_asset_id is not None,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_survey(
    body: SurveySubmit,
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, bool]:
    """Принять анкету и снять блокировку платформы. Сдать можно один раз."""
    if (existing := await _response_of(session, current_user.id)) is not None:
        # Ответ уже есть, а флаг всё ещё поднят (админ переприслал анкету, ручная
        # правка в БД) — снимаем его здесь, иначе человек заперт на экране анкеты
        # навсегда: отправить нельзя (409), а пройти дальше не даёт гейт.
        current_user.survey_required = False
        if current_user.graduated_at is None:
            current_user.graduated_at = existing.created_at
        # Именно commit, а не flush: дальше мы бросаем 409, а get_session на
        # исключении откатывает транзакцию — почин флага уехал бы вместе с ней.
        await session.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Survey already submitted"
        )
    try:
        answers = validate_answers(body.answers)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    session.add(
        SurveyResponse(
            user_id=current_user.id,
            version=SURVEY_VERSION,
            answers=answers,
            publish_consent=body.publish_consent,
        )
    )
    current_user.survey_required = False
    # Анкета сдана — экспедиция пройдена. Отсюда Динамика исчезает, Задачи
    # схлопываются до сданных, Рубка становится «только чтение»
    # (см. app/services/graduation.py).
    current_user.graduated_at = datetime.now(UTC)
    await session.flush()
    return {"gift_available": current_user.survey_gift_asset_id is not None}


@router.get("/gift", response_model=SurveyGiftOut)
async def get_survey_gift(
    current_user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SurveyGiftOut:
    """Ссылка на личную книгу. Только своя и только после сданной анкеты.

    Подписываем напрямую, минуя `assert_media_access`: у книги свой критерий
    доступа (сдал анкету + ассет привязан именно к тебе), общий чекер о ней
    ничего не знает.
    """
    if await _response_of(session, current_user.id) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Survey not submitted yet"
        )
    asset_id = current_user.survey_gift_asset_id
    asset = await session.get(MediaAsset, asset_id) if asset_id else None
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Gift is not ready yet"
        )

    filename = f"{current_user.username}.pdf"
    return SurveyGiftOut(
        url=presigned_get_url(asset.bucket, asset.storage_key, download_name=filename),
        expires_in=PRESIGN_GET_EXPIRES,
        filename=filename,
    )
