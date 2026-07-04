"""Приём обращений из раздела «Поддержка» (кнопки «Предложить улучшение» /
«Сообщить об ошибке»).

Создать обращение может любой активный пользователь — оно всегда привязано к нему
(user_id из токена, не из тела: п.1 CLAUDE.md, не доверяем id от клиента). Просмотр
и разбор обращений — только админ, эти эндпоинты в `app.api.admin`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.db.session import get_session
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.feedback import FeedbackCreate

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_feedback(
    body: FeedbackCreate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, str]:
    """Сохранить обращение текущего пользователя. Разбирает его админ в панели."""
    session.add(Feedback(user_id=current_user.id, kind=body.kind, body=body.body))
    await session.flush()
    return {"status": "ok"}
