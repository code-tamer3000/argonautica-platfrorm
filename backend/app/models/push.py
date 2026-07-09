"""Push-подписки браузеров/PWA для нативных уведомлений (Web Push, VAPID).

Одна строка = один зарегистрированный пуш-endpoint (браузер/устройство). Юзер
может держать несколько (телефон + десктоп). `endpoint` уникален глобально — его
выдаёт push-сервис браузера и это естественный ключ подписки. При переезде на
другой браузер старый endpoint протухает: push-сервис отвечает 404/410, и мы
удаляем мёртвую строку (см. services/push.py).
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # URL push-сервиса браузера (natural key подписки) — уникален глобально.
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # Ключи из PushSubscription.getKey() браузера — нужны pywebpush для шифрования.
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    # Для диагностики (какой браузер/устройство) — необязательно.
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
