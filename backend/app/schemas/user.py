"""Pydantic-схемы пользователей."""
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["participant", "admin"]


class AdminCreateUserRequest(BaseModel):
    """Вход для POST /api/admin/users. Пароль НЕ принимаем — сервер генерит сам.

    `intake_id` обязателен: участник без набора не имеет точки отсчёта окна Динамики.
    В БД колонка остаётся nullable (исторические записи), обязательность — на уровне API.
    """

    username: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    email: str | None = None  # str, не EmailStr — не тащим email-validator
    role: Role = "participant"
    intake_id: int
    # Тариф, по которому участник пришёл (бот-воронка ARG-92). Опционален: ручное
    # заведение через админку по-прежнему не требует тарифа.
    plan_id: int | None = None


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
    can_access_cabin: bool | None = None
    is_observer: bool | None = None
    role: Role | None = None
    # Перевод участника в другой набор — двигает начало его окна Динамики.
    intake_id: int | None = None


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
    can_access_cabin: bool
    is_observer: bool = False
    # Ждём выпускную анкету — фронт перекрывает платформу её экраном (AuthGuard).
    survey_required: bool = False
    # Экспедиция пройдена (анкета сдана): Динамика скрыта, Задачи только сданные,
    # Рубка — только чтение. См. app/services/graduation.py.
    graduated_at: datetime | None = None
    settings: dict[str, Any] = {}
    # Набор участника (ARG-106): дата старта — для гейта Рубки/Календаря на клиенте
    # (`today < intake_starts_on`); приветственный текст — для поп-апа при первом
    # входе. NULL/NULL — участник без набора или набор без текста (старые наборы).
    intake_starts_on: date | None = None
    intake_welcome_message: str | None = None


class PublicUserOut(BaseModel):
    """Публичный профиль (директория/по id) — без email/settings."""

    id: int
    username: str
    display_name: str
    avatar_url: str | None = None
    bio: str | None = None
    role: str


class AdminUserOut(BaseModel):
    """Ответ GET /api/admin/users — расширенный профиль с admin-полями.

    Включает can_create_groups и другие поля, недоступные через публичный API.
    is_active всегда True: платформа не поддерживает деактивацию пользователей.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: str
    email: str | None
    role: str
    can_create_groups: bool
    can_access_cabin: bool
    is_observer: bool = False
    is_active: bool = True
    graduated_at: datetime | None = None
    created_at: datetime
    # Набор участника: id + дата старта (денормализована, чтобы админка группировала
    # список без второго запроса). NULL — историческая запись без набора.
    intake_id: int | None = None
    intake_starts_on: date | None = None
    # Тариф, по которому пришёл (бот-воронка ARG-92) — денормализован тем же
    # приёмом, что intake_starts_on. NULL — заведён вручную без тарифа.
    plan_id: int | None = None
    plan_name: str | None = None
