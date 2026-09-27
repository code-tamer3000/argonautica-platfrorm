"""Pydantic-схемы клуба «Факел» (ARG-54)."""
from pydantic import BaseModel, ConfigDict, Field


class TorchRowOut(BaseModel):
    """Строка админского списка: один выпустившийся участник."""

    user_id: int
    username: str
    display_name: str
    torch_unlocked: bool


class TorchOverviewOut(BaseModel):
    """Админская сводка: строки по выпустившимся + текущая заглушка."""

    rows: list[TorchRowOut]
    stub_text: str


class TorchGrantRequest(BaseModel):
    """Кому открыть клуб. Пустой список — ошибка, нечего делать."""

    model_config = ConfigDict(extra="forbid")

    user_ids: list[int] = Field(min_length=1)


class TorchStubUpdateRequest(BaseModel):
    """Общий текст заглушки — один на всех закрытых."""

    model_config = ConfigDict(extra="forbid")

    stub_text: str = Field(min_length=1)


class TorchStubOut(BaseModel):
    """Что видит закрытый (torch_unlocked=false) выпускник вместо чата."""

    stub_text: str
