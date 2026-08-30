"""Круг Экспедиции: расписание этапов потока + выпавшие у участника гексаграммы.

Шесть этапов на поток (Точка Баланса → Воздух → Огонь → Вода → Земля → Финал),
каждый открывается эфиром; длина этапа не хранится — считается из соседних дат
(services/expedition.py:layout_stages). Четыре стихии несут по одному «замку» —
слоту, куда участник один раз вводит выпавшую ему гексаграмму (см. DECISIONS.md
про необратимость личных данных не требуется: ввод правится, это не бросок).
"""
from datetime import date as date_
from datetime import datetime, time

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

STAGE_KINDS = ("balance", "air", "fire", "water", "earth", "final")
ELEMENTS = ("air", "fire", "water", "earth")


class IntakeStage(Base):
    """Один этап расписания потока. `air_date`/`air_time` — момент эфира, который
    ОТКРЫВАЕТ этап (этап идёт до эфира следующего по порядку `STAGE_KINDS`).
    `task_id` — задание, сдача которого «раскрывает» замок этой стихии (см.
    services/expedition.py:lock_state); NULL для `balance`/`final` — им замок
    не полагается, и для стихии без привязанного задания (замок останавливается
    на «введён»).
    """

    __tablename__ = "intake_stages"
    __table_args__ = (
        CheckConstraint(f"kind IN {STAGE_KINDS!r}", name="intake_stage_kind_valid"),
        UniqueConstraint("intake_id", "kind", name="uq_intake_stages_intake_kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    intake_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("intakes.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    air_date: Mapped[date_] = mapped_column(Date, nullable=False)
    # МСК; NULL = момент открытия замка берётся как начало дня air_date (МСК).
    air_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    task_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )


class ExpeditionLock(Base):
    """Гексаграмма, введённая участником в замок одной из четырёх стихий.

    `UNIQUE(user_id, element)` — ровно четыре слота на участника, закреплённых
    навсегда; повторный ввод той же стихии правит запись (не плодит строки —
    это собственные данные человека, опечатка не должна остаться навсегда).
    `hexagram` денормализован от `key_number` (таблица Кинг Вэня) на сервере —
    клиент его не присылает, чтобы линии и номер не могли разойтись.
    """

    __tablename__ = "expedition_locks"
    __table_args__ = (
        CheckConstraint(f"element IN {ELEMENTS!r}", name="expedition_lock_element_valid"),
        CheckConstraint(
            "key_number >= 1 AND key_number <= 64", name="expedition_lock_key_number_valid"
        ),
        UniqueConstraint("user_id", "element", name="uq_expedition_locks_user_element"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    element: Mapped[str] = mapped_column(Text, nullable=False)
    key_number: Mapped[int] = mapped_column(Integer, nullable=False)
    hexagram: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
