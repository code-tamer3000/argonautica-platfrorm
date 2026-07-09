"""Схемы Web Push: регистрация подписки браузера + рассылка админом."""
from pydantic import BaseModel, Field


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    """Тело браузерного PushSubscription.toJSON() + опциональный user-agent."""

    endpoint: str
    keys: PushKeys
    user_agent: str | None = None


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


class VapidKeyOut(BaseModel):
    public_key: str


class AdminBroadcastRequest(BaseModel):
    """Админ-рассылка уведомления всем пользователям."""

    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=2000)
