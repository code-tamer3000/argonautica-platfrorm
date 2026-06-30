"""Pydantic-схемы пользователей."""
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["participant", "admin"]


class AdminCreateUserRequest(BaseModel):
    """Вход для POST /api/admin/users. Пароль НЕ принимаем — сервер генерит сам."""

    username: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    email: str | None = None  # str, не EmailStr — не тащим email-validator
    role: Role = "participant"


class AdminCreateUserResponse(BaseModel):
    """Ответ при создании. one_time_password показывается ОДИН раз."""

    id: int
    username: str
    one_time_password: str


class AdminUpdateUserRequest(BaseModel):
    """Частичное обновление юзера админом. Применяются только переданные поля.

    Заложено под расширение: будущие правки (бан, смена роли) добавляются полем
    здесь и в whitelist эндпоинта — без переписывания обработчика.
    """

    model_config = ConfigDict(extra="forbid")

    can_create_groups: bool | None = None


class ProfileUpdateRequest(BaseModel):
    """Редактирование своего профиля. Применяются только переданные поля.

    `avatar_media_id=null` — снять аватар; `bio=null` — очистить. `display_name`/
    `settings` пустыми (null) не зануляем (NOT NULL в БД).
    """

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    bio: str | None = None
    avatar_media_id: int | None = None
    settings: dict[str, Any] | None = None


class UserOut(BaseModel):
    """Свой профиль (GET/PATCH /me). `avatar_url` — подписанный media-URL или legacy."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str | None
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None
    role: str
    must_change_password: bool
    can_create_groups: bool
    settings: dict[str, Any] = {}


class PublicUserOut(BaseModel):
    """Публичный профиль (директория/по id) — без email/settings."""

    id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None
    role: str
