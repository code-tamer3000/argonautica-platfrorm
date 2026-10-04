"""Набор: когорта участников с общей датой старта 28-дневного окна Динамики."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Intake(Base):
    """Набор участников. Дата старта задаёт точку отсчёта окна Динамики для всех,
    кто к набору привязан (`users.intake_id`) — не структуру дневника, только окно.
    """

    __tablename__ = "intakes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    # Дата закрытия набора: внутри [starts_on, ends_on] Динамика идёт как обычно,
    # после — архив только на чтение (см. app/services/graduation.py-style гейт в
    # api/dynamics.py). Отдельная величина от 28-дневного окна ДЗ — совпадение дат
    # у исторического набора случайно.
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    # Текст приветственного поп-апа при первом входе (ARG-106) — тот же текст, что
    # уходит новостным постом при провижининге (`NEWS_BODY` в
    # scripts/provision_second_intake.py). NULL = поп-ап не показывается (старые
    # наборы, заведённые до этой фичи).
    welcome_message: Mapped[str | None] = mapped_column(Text)
    # «Факел» для потока (ARG-169): свой текст окна выпускника и заглушки клуба
    # (NULL = общий текст) и поток, чью базу знаний видят члены клуба из этого
    # потока (`torch_unlocked`) вдобавок к своей — NULL = только своя.
    graduation_popup_text: Mapped[str | None] = mapped_column(Text)
    torch_stub_text: Mapped[str | None] = mapped_column(Text)
    torch_kb_intake_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("intakes.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
