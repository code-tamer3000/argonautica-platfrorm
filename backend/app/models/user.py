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
    # Навигатор (ARG-110): только у role='admin' — доступен для лички ЛЮБОМУ тарифу
    # своего потока (обходит ранговое ограничение «пишут только топ-2 тарифа»).
    # Обычный админ без флага остаётся невидим игроку/наблюдателю в «начать чат».
    is_navigator: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    # Личный дневник админа (`rooms.is_personal`, обычно скрыт от участников,
    # см. `diary_visible`) показать участникам его СВОЕГО потока — разовое ручное
    # исключение для конкретного админа, не общее правило видимости. У остальных
    # админов дневник по-прежнему невиден никому кроме них самих.
    diary_public: Mapped[bool] = mapped_column(
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
    # Набор (когорта), к которому привязан пользователь — задаёт дату старта окна
    # Динамики. Nullable на этом шаге; обязательность и выбор при создании — в
    # подзадаче с админкой.
    intake_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("intakes.id")
    )
    # Тариф, по которому участник пришёл (бот-воронка ARG-92). Nullable: ручное
    # заведение через админку по-прежнему не требует тарифа. Changeable after
    # provisioning (см. PATCH /api/admin/users/{id}, docs/ROOMS.md "Tariff
    # change cleanup") — понижение с платного тарифа на самый дешёвый заводит
    # временное «Междумирье» (см. ниже, docs/LIMBO.md).
    plan_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("plans.id"))
    # Междумирье: все три поля NULL одновременно — не в междумирье; проставляются
    # вместе при входе (PATCH plan_id -> самый дешёвый тариф С платного) и вместе
    # обнуляются при выходе, успехом или истечением срока (см. services/limbo.py).
    limbo_previous_plan_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("plans.id")
    )
    limbo_deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    limbo_makeup_task_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("tasks.id")
    )
    # Точка отсчёта для счётчика «сдач после дедлайна» (ARG-130/ARG-128):
    # NULL = считать с начала; выставляется в момент входа/выхода из Междумирье
    # (services/limbo.py), чтобы предупреждение «ещё N раз — и Междумирье»
    # каждый раз отсчитывалось заново, а не копило штрафы бесконечно.
    discipline_reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
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
