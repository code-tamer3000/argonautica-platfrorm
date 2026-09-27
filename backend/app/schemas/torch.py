"""Pydantic-схемы клуба «Факел» (ARG-54, ARG-158)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TorchRowOut(BaseModel):
    """Строка админского списка: один выпустившийся участник."""

    user_id: int
    username: str
    display_name: str
    torch_unlocked: bool
    torch_applied_at: datetime | None


class TorchAdminCandidateOut(BaseModel):
    """Один пункт списка для выбора «Администратор Факела»."""

    user_id: int
    display_name: str


class TorchOverviewOut(BaseModel):
    """Админская сводка: строки по выпустившимся + текущая заглушка + назначенный админ."""

    rows: list[TorchRowOut]
    stub_text: str
    admin_user_id: int | None
    admin_candidates: list[TorchAdminCandidateOut]


class TorchGrantRequest(BaseModel):
    """Кому открыть клуб. Пустой список — ошибка, нечего делать."""

    model_config = ConfigDict(extra="forbid")

    user_ids: list[int] = Field(min_length=1)


class TorchStubUpdateRequest(BaseModel):
    """Общий текст заглушки — один на всех закрытых."""

    model_config = ConfigDict(extra="forbid")

    stub_text: str = Field(min_length=1)


class TorchAdminUpdateRequest(BaseModel):
    """Назначить (или снять) администратора Факела. `null` — снять назначение."""

    model_config = ConfigDict(extra="forbid")

    admin_user_id: int | None


class TorchStubOut(BaseModel):
    """Что видит закрытый (torch_unlocked=false) выпускник вместо чата."""

    stub_text: str
    # Кнопка «Подать заявку» на клиенте показывается только если тут не None
    # (см. TorchLocked.tsx) — без назначенного админа создавать DM не с кем.
    apply_admin_id: int | None


class TorchApplyOut(BaseModel):
    """Куда перейти после подачи заявки — id DM с назначенным админом."""

    room_id: int
