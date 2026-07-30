"""Пользователи платформы."""
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('participant', 'admin')", name="role_valid"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # Логин = TG-аккаунт. Платформа закрытая, регистрации нет — заводит админ.
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    email: Mapped[str | None] = mapped_column(Text, unique=True)  # опционален
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(Text)  # legacy/внешний URL
    # Аватар как media-ассет: presigned-GET подписываем на чтение (avatar_url оставлен
    # под внешний URL — приоритет у media_id).
    avatar_media_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media_assets.id")
    )
    bio: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="participant")
    # Временный (одноразовый) пароль выдан админом — юзер обязан сменить при входе.
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Право создавать группы (по умолчанию у всех; админ может отнять).
    can_create_groups: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    # Доступ к разделу «Каюта» (по умолчанию закрыт; админ выдаёт вручную).
    can_access_cabin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Режим наблюдателя: пассивный доступ «только к материалам» (База знаний,
    # Новости — только чтение, Генные ключи). Отнимает Рубку, Задачи, Календарь,
    # Каюту, Динамику и уведомления. Админ включает вручную; у админа не бывает.
    is_observer: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Выпускная анкета экспедиции: админ поднимает флаг — платформа целиком
    # перекрыта экраном анкеты (см. deps.get_current_active_user), пока человек
    # её не отправит. Снимается автоматически при отправке.
    survey_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Экспедиция пройдена: проставляется в момент отправки выпускной анкеты и больше
    # не снимается. Это не блокировка доступа, а конец пути: Динамика исчезает,
    # Задачи схлопываются до сданных, вся Рубка переходит в режим «только чтение»
    # (см. app/services/graduation.py).
    graduated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Подарок за анкету: персональная PDF-книга пути. Загружает админ в панели.
    survey_gift_asset_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("media_assets.id")
    )
    # Настройки кабинета (тема, предпочтения) — без миграций под новые ключи.
    settings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
