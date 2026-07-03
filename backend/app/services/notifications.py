"""Генерация уведомлений при новом сообщении.

Вызывается из эндпоинтов отправки (messages.py) в той же транзакции. Правила
получателей (см. CLAUDE.md — треды плоские, п.2):
- ответ в тред → автору КОРНЯ треда (это и есть «ответили на твоё сообщение»);
- личка (верхний уровень в dm) → второму участнику;
- пост в новостях (верхний уровень в is_news канале) → всем, кроме автора.
Себе уведомление не создаём. Доставка в реальном времени — персональный канал
`user:{id}` в Redis pub/sub (publish_user_event).
"""
import logging
import re
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.message import Message
from app.models.notification import Notification
from app.models.room import Room, RoomMember
from app.models.user import User
from app.schemas.notification import NotificationOut
from app.ws import schemas as ws_schemas
from app.ws.pubsub import publish_user_event

logger = logging.getLogger(__name__)

_PREVIEW_LEN = 120
# Служебный маркер категорий дневника в начале content — в превью не нужен.
_JOURNAL_MARKER = re.compile(r"^<!--journal:[a-z]+-->")
# Насколько глубоко назад досоздаём «пропущенные дни», если юзер долго не заходил.
_JOURNAL_MISSED_WINDOW = 14


def _preview(content: str | None) -> str | None:
    if not content:
        return None
    text = _JOURNAL_MARKER.sub("", content).strip()
    if not text:
        return None
    return text[:_PREVIEW_LEN]


def journal_missed_preview(ref_date: date | None) -> str:
    """Текст уведомления о незакрытом дне дневника."""
    if ref_date is None:
        return "День дневника не закрыт"
    return f"День {ref_date:%d.%m} закрыт не был — задачи дневника не выполнены"


async def _reply_recipient(session: AsyncSession, message: Message) -> int | None:
    """Автор корня треда (кому ответили)."""
    root = await session.get(Message, message.thread_root_id)
    if root is None or root.sender_id == message.sender_id:
        return None
    return root.sender_id


async def _dm_recipient(session: AsyncSession, message: Message) -> int | None:
    """Второй участник личного чата."""
    recipient: int | None = await session.scalar(
        select(RoomMember.user_id).where(
            RoomMember.room_id == message.room_id,
            RoomMember.user_id != message.sender_id,
        )
    )
    return recipient


async def _news_recipients(session: AsyncSession, sender_id: int) -> list[int]:
    """Все пользователи платформы, кроме автора поста."""
    rows = await session.execute(select(User.id).where(User.id != sender_id))
    return list(rows.scalars().all())


async def _recipients(
    session: AsyncSession, message: Message, room: Room
) -> tuple[str, list[int]]:
    """(kind, [user_id]) получателей для этого сообщения. Пусто → уведомлять некого."""
    if message.thread_root_id is not None:
        recipient = await _reply_recipient(session, message)
        return "reply", [recipient] if recipient is not None else []
    if room.type == "dm":
        recipient = await _dm_recipient(session, message)
        return "dm", [recipient] if recipient is not None else []
    if room.is_news:
        return "news", await _news_recipients(session, message.sender_id)
    # Верхнеуровневые сообщения в группах/личных каналах — только бейдж непрочитанных.
    return "", []


async def on_new_message(
    session: AsyncSession, message: Message, room: Room, sender: User
) -> None:
    """Создать уведомления по новому сообщению и разослать их в реальном времени.

    Не должна ронять основной путь отправки: любую ошибку логируем и глотаем.
    """
    try:
        kind, recipient_ids = await _recipients(session, message, room)
        if not recipient_ids:
            return

        preview = _preview(message.content)
        rows = [
            Notification(
                user_id=uid,
                kind=kind,
                room_id=message.room_id,
                message_id=message.id,
                actor_id=sender.id,
            )
            for uid in recipient_ids
        ]
        session.add_all(rows)
        await session.flush()  # присваивает id и created_at (нужны для payload)
        for row in rows:
            await session.refresh(row)
            out = NotificationOut(
                id=row.id,
                kind=row.kind,
                room_id=row.room_id,
                message_id=row.message_id,
                actor_id=row.actor_id,
                actor_name=sender.display_name,
                preview=preview,
                ref_date=None,
                created_at=row.created_at,
                read_at=row.read_at,
            )
            await publish_user_event(
                row.user_id, ws_schemas.notification_new_event(out)
            )
    except Exception:
        logger.exception("Failed to create notifications for message %s", message.id)


async def ensure_journal_notifications(session: AsyncSession, user: User) -> None:
    """Досоздать уведомления о незакрытых днях дневника (по одному на день).

    Вызывается лениво при загрузке ленты уведомлений (планировщика нет). «Пропущенный
    день» = прошедший день с начала программы, где закрыты не все категории дневника
    и который не помилован (та же логика, что в разделе «Динамика»). Идемпотентно:
    дедуп по (user, kind='journal_missed', ref_date). Ошибку логируем и глотаем, чтобы
    не ронять выдачу ленты.

    Импорт хелперов «Динамики» — локальный, чтобы избежать цикла на уровне модуля
    (api.dynamics тянет схемы/модели, но не сервис уведомлений).
    """
    try:
        from app.api.dynamics import (
            _calc_closed_days,
            _calc_stats,
            _load_journal_messages,
            _load_pardons,
            _personal_room_id,
            _platform_today,
        )

        program_start = settings.journal_program_start
        today = _platform_today()
        if today - timedelta(days=1) < program_start:
            return  # ещё не наступил ни один завершённый день программы

        room_id = await _personal_room_id(session, user.id)
        if room_id is None:
            return  # нет личного дневника — нечего проверять

        messages = await _load_journal_messages(session, room_id, program_start)
        pardons = await _load_pardons(session, user.id)
        per_day = _calc_closed_days(messages)
        stats = _calc_stats(per_day, pardons, program_start)

        # Пропущенные дни в пределах окна (не досоздаём всю историю разом).
        cutoff = today - timedelta(days=_JOURNAL_MISSED_WINDOW)
        missed = [d for d in stats["overdue_dates"] if d >= cutoff]
        if not missed:
            return

        existing_rows = await session.execute(
            select(Notification.ref_date).where(
                Notification.user_id == user.id,
                Notification.kind == "journal_missed",
            )
        )
        already = {d for (d,) in existing_rows.all() if d is not None}
        new_dates = [d for d in missed if d not in already]
        if not new_dates:
            return

        for d in new_dates:
            session.add(
                Notification(
                    user_id=user.id,
                    kind="journal_missed",
                    room_id=room_id,
                    ref_date=d,
                )
            )
        await session.flush()
    except Exception:
        logger.exception("Failed to ensure journal notifications for user %s", user.id)
