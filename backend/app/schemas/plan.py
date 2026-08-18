"""Pydantic-схемы тарифов (ARG-92)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PlanCreateRequest(BaseModel):
    """Новый тариф (создаёт админ)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    price: int = Field(ge=0)
    description: str = Field(default="", max_length=4000)
    is_active: bool = True


class PlanUpdateRequest(BaseModel):
    """Частичное обновление тарифа."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    price: int | None = Field(default=None, ge=0)
    description: str | None = Field(default=None, max_length=4000)
    is_active: bool | None = None


class PlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: int
    description: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
