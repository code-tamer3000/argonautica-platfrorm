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

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.message import Message
from app.models.notification import Notification
from app.models.room import Room, RoomMember
from app.models.user import User
from app.schemas.notification import NotificationOut
from app.services import push as push_service
from app.services.notify_prefs import push_allowed
from app.ws import schemas as ws_schemas
from app.ws.pubsub import publish_user_event

logger = logging.getLogger(__name__)

_PREVIEW_LEN = 120
# Служебный маркер категорий дневника в начале content — в превью не нужен.
_JOURNAL_MARKER = re.compile(r"^<!--journal:[a-z0-9_]+-->")


def _preview(content: str | None) -> str | None:
    if not content:
        return None
    text = _JOURNAL_MARKER.sub("", content).strip()
    if not text:
        return None
    return text[:_PREVIEW_LEN]


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


# @упоминание: `@username` — латиница/цифры/подчёркивание (как в Telegram-нике).
# Границу слева держим на неслове, чтобы не ловить e-mail (foo@bar) и т.п.
_MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_]{1,32})")


def _mentioned_usernames(content: str | None) -> set[str]:
    """Уникальные @ники из текста, в нижнем регистре (сравнение регистронезависимо)."""
    if not content:
        return set()
    return {m.lower() for m in _MENTION_RE.findall(content)}


async def _room_user_ids(session: AsyncSession, room: Room) -> set[int] | None:
    """Кто имеет доступ к комнате (для проверки права на упоминание).

    channel — доступ у всех участников платформы (вариант А), возвращаем None как
    «все». dm/group — только по строкам членства (IDOR: нельзя пинговать чужого,
    кто не в комнате).
    """
    if room.type == "channel":
        return None
    rows = await session.execute(
        select(RoomMember.user_id).where(RoomMember.room_id == room.id)
    )
    return set(rows.scalars().all())


async def _mention_recipient_ids(
    session: AsyncSession, message: Message, room: Room
) -> list[int]:
    """id пользователей, упомянутых через @ в тексте и имеющих доступ к комнате.

    Себя не уведомляем. Для dm/group упоминание чужого (не участника) молча
    игнорируем — уведомление ушло бы тому, кто комнату даже не видит.
    """
    usernames = _mentioned_usernames(message.content)
    if not usernames:
        return []
    rows = await session.execute(
        select(User.id, User.username).where(func.lower(User.username).in_(usernames))
    )
    allowed = await _room_user_ids(session, room)
    result: list[int] = []
    for uid, _username in rows.all():
        if uid == message.sender_id:
            continue
        if allowed is not None and uid not in allowed:
            continue
        result.append(uid)
    return result


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
        # Основной вид (reply/dm/news) + @упоминания. Один пользователь получает не
        # более одного уведомления по сообщению: основной вид приоритетнее mention
        # (не пингуем дважды того, кому и так «ответили»/пришла личка).
        kind, recipient_ids = await _recipients(session, message, room)
        kind_by_uid: dict[int, str] = {uid: kind for uid in recipient_ids}
        for uid in await _mention_recipient_ids(session, message, room):
            kind_by_uid.setdefault(uid, "mention")
        if not kind_by_uid:
            return

        preview = _preview(message.content)
        # Настройки получателей — для фильтра нативного push (in-app лента идёт всем).
        rows_settings = (
            await session.execute(
                select(User.id, User.settings).where(User.id.in_(kind_by_uid))
            )
        ).all()
        settings_by_uid: dict[int, dict[str, object]] = {
            uid: s for uid, s in rows_settings
        }
        rows = [
            Notification(
                user_id=uid,
                kind=row_kind,
                room_id=message.room_id,
                message_id=message.id,
                actor_id=sender.id,
            )
            for uid, row_kind in kind_by_uid.items()
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
            if push_allowed(settings_by_uid.get(row.user_id), row.kind):
                # Клик по push ведёт в приложение: новости — на /news (канал
                # авто-открывается), остальные комнаты открываются через ленту на /.
                url = "/news" if row.kind == "news" else "/"
                push_service.enqueue_push(
                    row.user_id,
                    push_service.build_payload(
                        title=sender.display_name,
                        body=preview,
                        url=url,
                        tag=f"room-{message.room_id}",
                    ),
                )
    except Exception:
        logger.exception("Failed to create notifications for message %s", message.id)


async def broadcast_admin(
    session: AsyncSession, title: str, body: str
) -> int:
    """Разослать админ-уведомление всем пользователям платформы.

    Создаёт по строке в ленте каждому + WS-событие + нативный push тем, у кого
    включён тумблер `admin`. В отличие от message-driven путей, тут ошибку НЕ
    глотаем — это явное действие админа, ему важно знать результат. Возвращает
    число адресатов.
    """
    users = (
        await session.execute(select(User.id, User.settings))
    ).all()
    preview = _preview(body)
    for uid, user_settings in users:
        row = Notification(user_id=uid, kind="admin", title=title, body=body)
        session.add(row)
        await session.flush()
        await session.refresh(row)
        out = NotificationOut(
            id=row.id,
            kind="admin",
            room_id=None,
            message_id=None,
            actor_id=None,
            actor_name=None,
            preview=preview,
            ref_date=None,
            title=title,
            created_at=row.created_at,
            read_at=row.read_at,
        )
        await publish_user_event(uid, ws_schemas.notification_new_event(out))
        if push_allowed(user_settings, "admin"):
            push_service.enqueue_push(
                uid,
                push_service.build_payload(
                    title=title, body=preview, url="/", tag=f"admin-{row.id}"
                ),
            )
    return len(users)


async def notify_cabin_granted(session: AsyncSession, user_id: int) -> None:
    """Уведомить участника, что админ открыл ему раздел «Каюта».

    Системное уведомление без привязки к комнате (room_id пуст) и без автора —
    клик по нему ведёт в /cabin (обрабатывается на фронте по kind). Идемпотентности
    не требуется: вызывается только на переходе флага false→true. Ошибку логируем и
    глотаем, чтобы не ронять сам PATCH пользователя.
    """
    try:
        row = Notification(user_id=user_id, kind="cabin_granted")
        session.add(row)
        await session.flush()
        await session.refresh(row)
        out = NotificationOut(
            id=row.id,
            kind="cabin_granted",
            room_id=None,
            message_id=None,
            actor_id=None,
            actor_name=None,
            preview=None,
            ref_date=None,
            created_at=row.created_at,
            read_at=row.read_at,
        )
        await publish_user_event(user_id, ws_schemas.notification_new_event(out))
        user_settings = await session.scalar(
            select(User.settings).where(User.id == user_id)
        )
        if push_allowed(user_settings, "cabin_granted"):
            push_service.enqueue_push(
                user_id,
                push_service.build_payload(
                    title="Открыт доступ к разделу «Каюта»",
                    body="Нажмите, чтобы перейти",
                    url="/cabin",
                    tag="cabin-granted",
                ),
            )
    except Exception:
        logger.exception("Failed to create cabin_granted notification for user %s", user_id)
