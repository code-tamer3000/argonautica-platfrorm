"""Pydantic-схемы выпускной анкеты.

Сами вопросы описаны в `app.services.survey_form` — сюда они попадают уже
сериализованными (`question_form()`), поэтому форма отдаётся `dict`, а не типом
на каждый вид вопроса: канон меняется чаще, чем контракт эндпоинта.
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SurveyFormOut(BaseModel):
    """Что показывать пользователю: форма + его состояние по ней."""

    version: int
    title: str
    subtitle: str
    intro: str
    consent_label: str
    questions: list[dict[str, Any]]
    # Заполнена ли анкета и ждёт ли она ответа прямо сейчас.
    completed_at: datetime | None
    required: bool
    # Персональная книга привязана — после отправки будет что скачать.
    gift_available: bool


class SurveySubmit(BaseModel):
    """Ответы одним словарём `{ключ вопроса: ответ}` — разбирает survey_form."""

    model_config = ConfigDict(extra="forbid")

    answers: dict[str, Any]
    publish_consent: bool = False


class SurveyGiftOut(BaseModel):
    """Presigned-ссылка на личную книгу."""

    url: str
    expires_in: int
    filename: str


class SurveyRowOut(BaseModel):
    """Строка админской таблицы: один участник."""

    user_id: int
    username: str
    display_name: str
    invited: bool
    completed_at: datetime | None
    publish_consent: bool
    has_gift: bool
    gift_asset_id: int | None
    answers: dict[str, Any] | None
    version: int | None


class SurveyOverviewOut(BaseModel):
    """Админская сводка: форма (для подписей) + строки + счётчики."""

    form: dict[str, Any]
    rows: list[SurveyRowOut]
    invited_count: int
    completed_count: int


class SurveyInviteRequest(BaseModel):
    """Кому показать анкету. Пустой список — ошибка, нечего делать."""

    model_config = ConfigDict(extra="forbid")

    user_ids: list[int] = Field(min_length=1)


class SurveyGiftRequest(BaseModel):
    """Привязать книгу к участнику (или отвязать: media_asset_id = null)."""

    model_config = ConfigDict(extra="forbid")

    media_asset_id: int | None
