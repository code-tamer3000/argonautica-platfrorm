"""Журнал-прогресс: помилования (участник), ручные зачёты дней (админ) и
конфигурация структуры дневника — «задания» (journal_programs) с их разделами."""
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class JournalPardon(Base):
    """Одно помилование = один прощённый пропущенный день у пользователя."""

    __tablename__ = "journal_pardons"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_journal_pardons_user_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class JournalCredit(Base):
    """Ручной зачёт дня админом = день считается полностью закрытым (как closed).

    Отдельно от помилований: без лимита, ставит админ вручную (человек мог сдать
    не через форму, был сбой по времени и т.п.). Учитывается наравне с закрытыми днями.
    """

    __tablename__ = "journal_credits"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_journal_credits_user_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    granted_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class JournalProgram(Base):
    """«Задание» дневника = версия структуры, действующая с даты `starts_on`.

    Задания образуют временну́ю шкалу: активное для дня D — задание с максимальным
    `starts_on <= D`. Так смена структуры не ломает историю (прошлые дни считаются
    по заданию, действовавшему тогда). Прогресс (стрик/просрочки) — непрерывный.
    """

    __tablename__ = "journal_programs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL = системное задание (сид миграции); задания из админки несут id создателя.
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    sections: Mapped[list["JournalSection"]] = relationship(
        back_populates="program",
        cascade="all, delete-orphan",
        order_by="JournalSection.position",
    )


class JournalSection(Base):
    """Раздел дневника внутри задания.

    `key` — стабильный slug ([a-z0-9_]+), которым помечается сообщение-запись
    (`<!--journal:{key}-->`); по нему день засчитывает раздел. `input_type`:
    `text` — многострочное тело под фиксированным заголовком; `title` —
    однострочный ввод, сам текст становится заголовком (как прежний film).
    """

    __tablename__ = "journal_sections"
    __table_args__ = (
        UniqueConstraint("program_id", "key", name="uq_journal_sections_program_key"),
        UniqueConstraint("program_id", "position", name="uq_journal_sections_program_position"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    program_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("journal_programs.id", ondelete="CASCADE"), nullable=False
    )
    key: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    emoji: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    label: Mapped[str] = mapped_column(Text, nullable=False)
    heading: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    placeholder: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    input_type: Mapped[str] = mapped_column(Text, nullable=False, server_default="text")

    program: Mapped["JournalProgram"] = relationship(back_populates="sections")
