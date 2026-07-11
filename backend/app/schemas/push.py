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


class UserNotifPrefsOut(BaseModel):
    """Настройки уведомлений одного пользователя — для админ-обзора «у кого включено».

    push_enabled — мастер-согласие на native push. Пер-видовые
    (dm/reply/news/mention/admin) — что именно пушить (по умолчанию всё включено).
    devices — сколько активных push-подписок (браузеров/устройств) зарегистрировано.
    """

    user_id: int
    display_name: str
    push_enabled: bool
    dm: bool
    reply: bool
    news: bool
    mention: bool
    admin: bool
    devices: int


class NotifPrefsOverviewOut(BaseModel):
    items: list[UserNotifPrefsOut]
