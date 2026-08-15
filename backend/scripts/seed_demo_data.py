"""One-off: заполнить локальную БД разнородными демо-данными для проверки UI глазами.

Пустой стенд визуальной проверкой не считается (см. скилл /work): на чистой БД любой
экран показывает только пустое состояние. Этот скрипт даёт заполненные списки, карточки,
бейджи и краевые случаи — то, на что реально можно смотреть.

Запуск против локального прод-подобного стека (`make local-up`):

    docker compose -p platform-local -f docker/docker-compose.prod.yml --env-file .env \\
        exec -T backend-blue python -m scripts.seed_demo_data

Идемпотентность НЕ гарантируется — рассчитан на запуск против почти пустой БД.

ВАЖНО: скрипт заводит боевые учётки с общеизвестным паролем, поэтому отказывается
работать против чего-либо, кроме локальной БД. Обойти можно только осознанно —
SEED_ALLOW_NONLOCAL=1.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal

# Локальными считаем только контейнерный/хостовой dev-адрес. Прод и стенд ходят
# в БД по другим хостам, поэтому сюда не попадут.
_LOCAL_DB_HOSTS = ("@postgres", "@localhost", "@127.0.0.1")


def _guard_local_db() -> None:
    if os.getenv("SEED_ALLOW_NONLOCAL") == "1":
        return
    url = settings.database_url
    if not any(host in url for host in _LOCAL_DB_HOSTS):
        safe = url.split("@")[-1] if "@" in url else url
        print(
            f"ОТКАЗ: БД не выглядит локальной ({safe}).\n"
            "Скрипт создаёт учётки с паролем 'password123' — против прода или стенда "
            "это дыра.\nЕсли точно знаешь, что делаешь: SEED_ALLOW_NONLOCAL=1",
            file=sys.stderr,
        )
        raise SystemExit(1)
from app.models.cabin import CabinEntry
from app.models.calendar import CalendarEvent
from app.models.faq import FaqItem
from app.models.feedback import Feedback
from app.models.journal import JournalCredit, JournalPardon
from app.models.kb import KbCategory, KbItem
from app.models.message import Message, PinnedMessage
from app.models.notification import Notification
from app.models.room import Room, RoomMember
from app.models.task import Task, TaskAssignment, TaskComment, TaskSubmission
from app.models.user import User

PASSWORD = "password123"
NOW = datetime.now(timezone.utc)


def days_ago(n: int, hour: int = 12) -> datetime:
    return (NOW - timedelta(days=n)).replace(hour=hour, minute=0, second=0, microsecond=0)


async def main() -> None:
    async with SessionLocal() as s:
        # ------------------------------------------------------------------ users
        users_spec = [
            dict(username="admin1", display_name="Марина Соколова", role="admin"),
            dict(username="admin2", display_name="Игорь Волков", role="admin"),
            dict(username="anna_k", display_name="Анна Кузнецова"),
            dict(username="dmitry_p", display_name="Дмитрий Петров"),
            dict(
                username="elena_s",
                display_name="Елена Смирнова",
                is_observer=True,
            ),
            dict(
                username="sergey_m",
                display_name="Сергей Морозов",
                is_observer=True,
            ),
            dict(
                username="olga_v",
                display_name="Ольга Васильева",
                survey_required=True,
            ),
            dict(
                username="pavel_n",
                display_name="Павел Новиков",
                graduated_at=days_ago(10),
            ),
            dict(
                username="tatiana_l",
                display_name="Татьяна Лебедева",
                can_access_cabin=True,
            ),
        ]
        users: dict[str, User] = {}
        for spec in users_spec:
            username = spec["username"]
            existing = (
                await s.execute(select(User).where(User.username == username))
            ).scalar_one_or_none()
            if existing:
                users[username] = existing
                continue
            u = User(
                username=username,
                display_name=spec["display_name"],
                password_hash=hash_password(PASSWORD),
                role=spec.get("role", "participant"),
                can_access_cabin=spec.get("can_access_cabin", False),
                is_observer=spec.get("is_observer", False),
                survey_required=spec.get("survey_required", False),
                graduated_at=spec.get("graduated_at"),
                bio="Демо-участник экспедиции.",
            )
            s.add(u)
            await s.flush()
            users[username] = u

            # личный канал, как в create_users.py / admin API
            s.add(
                Room(
                    type="channel",
                    name=u.display_name,
                    is_personal=True,
                    created_by=u.id,
                )
            )
        await s.flush()

        admin1, admin2 = users["admin1"], users["admin2"]
        anna, dmitry, elena, sergey, olga, pavel, tatiana = (
            users["anna_k"],
            users["dmitry_p"],
            users["elena_s"],
            users["sergey_m"],
            users["olga_v"],
            users["pavel_n"],
            users["tatiana_l"],
        )

        # ------------------------------------------------------------------ rooms
        # DM 1: admin1 <-> anna
        dm1 = Room(
            type="dm",
            dm_key=f"{min(admin1.id, anna.id)}:{max(admin1.id, anna.id)}",
            created_by=admin1.id,
        )
        # DM 2: dmitry <-> elena
        dm2 = Room(
            type="dm",
            dm_key=f"{min(dmitry.id, elena.id)}:{max(dmitry.id, elena.id)}",
            created_by=dmitry.id,
        )
        s.add_all([dm1, dm2])
        await s.flush()
        s.add_all(
            [
                RoomMember(room_id=dm1.id, user_id=admin1.id, role_in_room="owner"),
                RoomMember(room_id=dm1.id, user_id=anna.id, role_in_room="member"),
                RoomMember(room_id=dm2.id, user_id=dmitry.id, role_in_room="owner"),
                RoomMember(room_id=dm2.id, user_id=elena.id, role_in_room="member"),
            ]
        )

        # Group chat: 5 members
        group = Room(type="group", name="Группа «Навигаторы»", created_by=anna.id)
        s.add(group)
        await s.flush()
        group_members = [anna, dmitry, olga, pavel, tatiana]
        s.add_all(
            [
                RoomMember(
                    room_id=group.id,
                    user_id=m.id,
                    role_in_room="owner" if m is anna else "member",
                )
                for m in group_members
            ]
        )

        # Admin-only channel (implicit access for everyone else; no room_members rows
        # for regular members per docs/ROOMS.md — only admins get an explicit row here
        # since they created/manage it).
        channel = Room(type="channel", name="Объявления", created_by=admin1.id)
        s.add(channel)
        await s.flush()

        await s.flush()

        # ------------------------------------------------------------------ messages
        def msg(room_id: int, sender_id: int, content: str, **kw) -> Message:
            m = Message(room_id=room_id, sender_id=sender_id, content=content, **kw)
            s.add(m)
            return m

        # DM1
        await s.flush()
        m1 = msg(dm1.id, admin1.id, "Привет! Как продвигается модуль про Динамику?")
        m2 = msg(dm1.id, anna.id, "Привет, Марина! Почти закончила, вечером пришлю черновик.")
        m3 = msg(dm1.id, admin1.id, "Отлично, жду 🙂")
        await s.flush()

        # DM2
        m4 = msg(dm2.id, dmitry.id, "Лена, глянешь моё домашнее задание за вчера?")
        m5 = msg(dm2.id, elena.id, "Конечно, скинь ссылку.")
        await s.flush()

        # Group
        g1 = msg(group.id, anna.id, "Всем привет! Начинаем неделю 🚀")
        g2 = msg(group.id, dmitry.id, "Привет-привет!")
        g3 = msg(group.id, olga.id, "Доброе утро, команда")
        await s.flush()
        # thread on g1
        g1_reply1 = msg(
            group.id, pavel.id, "А во сколько сегодня созвон?", thread_root_id=g1.id
        )
        await s.flush()
        g1_reply2 = msg(
            group.id, anna.id, "В 19:00 по МСК, ссылку скину позже", thread_root_id=g1.id
        )
        await s.flush()
        g1.reply_count = 2
        g1.last_reply_at = g1_reply2.created_at

        g4 = msg(group.id, tatiana.id, "Кто-нибудь уже прошёл сегодняшнее задание?")
        g5 = msg(group.id, dmitry.id, "Я в процессе, отпишусь")
        # edited message
        g6 = msg(group.id, olga.id, "Опечатка была, поправила текст", edited_at=NOW)
        # soft-deleted message
        g7 = msg(group.id, pavel.id, "тестовое сообщение", deleted_at=NOW)
        await s.flush()

        # Channel (admin posts, everyone reads)
        c1 = msg(channel.id, admin1.id, "Добро пожаловать в канал объявлений платформы!")
        c2 = msg(
            channel.id,
            admin2.id,
            "Напоминаем: дедлайн по общей задаче — в это воскресенье.",
        )
        await s.flush()

        # A few more scattered messages to hit 15-30 total
        msg(dm1.id, anna.id, "Кстати, спасибо за обратную связь на прошлой неделе!")
        msg(group.id, sergey.id if False else anna.id, "Хорошего дня всем 🌞")
        msg(channel.id, admin1.id, "Обновили раздел «База знаний» — загляните.")
        await s.flush()

        # pinned message
        s.add(PinnedMessage(room_id=group.id, message_id=g1.id, pinned_by=anna.id))
        s.add(PinnedMessage(room_id=channel.id, message_id=c1.id, pinned_by=admin1.id))

        # read receipts (a couple of memberships)
        await s.flush()
        for rm_room_id, rm_user_id, last_msg in [
            (dm1.id, anna.id, m3.id),
            (group.id, dmitry.id, g3.id),
        ]:
            rm = (
                await s.execute(
                    select(RoomMember).where(
                        RoomMember.room_id == rm_room_id,
                        RoomMember.user_id == rm_user_id,
                    )
                )
            ).scalar_one()
            rm.last_read_message_id = last_msg

        # ------------------------------------------------------------------ KB
        cat1 = KbCategory(title="Основы экспедиции", sort_order=0)
        cat2 = KbCategory(title="Практики", sort_order=1)
        s.add_all([cat1, cat2])
        await s.flush()

        kb1 = KbItem(
            category_id=cat1.id,
            title="Введение в путь",
            body="# Введение\n\nЭто вводный материал для всех участников экспедиции.",
            published=True,
            created_by=admin1.id,
        )
        kb2 = KbItem(
            category_id=cat2.id,
            title="Практика утренней рефлексии",
            body="## Практика\n\nКороткое упражнение на 10 минут по утрам.",
            published=True,
            created_by=admin1.id,
        )
        kb3 = KbItem(
            category_id=cat2.id,
            title="Черновик: продвинутая техника",
            body="Пока не готово к публикации, черновик.",
            published=False,
            created_by=admin2.id,
        )
        s.add_all([kb1, kb2, kb3])
        await s.flush()

        # ------------------------------------------------------------------ Tasks
        common_task = Task(
            type="common",
            title="Напишите про свою цель на месяц",
            body="Опишите одну ключевую цель на ближайший месяц и шаги к ней.",
            deadline_at=NOW + timedelta(days=5),
            created_by=admin1.id,
        )
        individual_task = Task(
            type="individual",
            title="Индивидуальное задание: разбор кейса",
            body="Разберите свой кейс по шаблону из материала «Практика».",
            kb_item_id=kb2.id,
            deadline_at=NOW + timedelta(days=3),
            created_by=admin1.id,
        )
        s.add_all([common_task, individual_task])
        await s.flush()

        # common task: lazy assignment on first submission
        assign_common = TaskAssignment(
            task_id=common_task.id, user_id=anna.id, status="submitted"
        )
        s.add(assign_common)
        await s.flush()
        sub_common = TaskSubmission(
            assignment_id=assign_common.id,
            body="Моя цель на месяц — выстроить регулярную практику дневника.",
        )
        s.add(sub_common)
        await s.flush()

        # individual task assigned to dmitry, reviewed/accepted with comment
        assign_ind = TaskAssignment(
            task_id=individual_task.id,
            user_id=dmitry.id,
            status="accepted",
            reviewed_at=NOW,
        )
        s.add(assign_ind)
        await s.flush()
        sub_ind = TaskSubmission(
            assignment_id=assign_ind.id,
            body="Вот мой разбор кейса по предложенному шаблону.",
        )
        s.add(sub_ind)
        await s.flush()
        s.add(
            TaskComment(
                submission_id=sub_ind.id,
                author_id=admin1.id,
                body="Отлично, принято! Хорошая глубина разбора.",
            )
        )

        # a second, still-open individual assignment for olga (no submission)
        s.add(TaskAssignment(task_id=individual_task.id, user_id=olga.id, status="assigned"))

        await s.flush()

        # ------------------------------------------------------------------ Dynamics (journal)
        # Homework entries are ordinary messages in the user's personal room, marked
        # with <!--journal:{key}--> (docs/DYNAMICS.md). Seeded program #1 has keys
        # focus/notes/film.
        async def personal_room_id(user: User) -> int:
            r = (
                await s.execute(
                    select(Room).where(Room.created_by == user.id, Room.is_personal.is_(True))
                )
            ).scalar_one()
            return r.id

        for user, days in [(anna, 6), (dmitry, 4)]:
            room_id = await personal_room_id(user)
            for d in range(days):
                created = days_ago(days - d, hour=9)
                msg(
                    room_id,
                    user.id,
                    f"<!--journal:focus-->## 🎯 Фокус на день\nСконцентрироваться на дне {d + 1}.",
                    created_at=created,
                )
                msg(
                    room_id,
                    user.id,
                    f"<!--journal:notes-->## 📝 Заметки\nЗаметки за день {d + 1}.",
                    created_at=created,
                )
                msg(
                    room_id,
                    user.id,
                    f"<!--journal:film-->День {d + 1}: «Маленькие шаги»",
                    created_at=created,
                )
        await s.flush()

        # pardon + credit
        s.add(JournalPardon(user_id=anna.id, date=date.today() - timedelta(days=8)))
        s.add(
            JournalCredit(
                user_id=dmitry.id,
                date=date.today() - timedelta(days=6),
                granted_by=admin1.id,
            )
        )

        # ------------------------------------------------------------------ Notifications
        notifications = [
            Notification(
                user_id=anna.id,
                kind="reply",
                room_id=group.id,
                message_id=g1_reply1.id,
                actor_id=pavel.id,
                body="Павел ответил в вашем сообщении",
            ),
            Notification(
                user_id=anna.id,
                kind="dm",
                room_id=dm1.id,
                message_id=m1.id,
                actor_id=admin1.id,
                body="Новое личное сообщение",
            ),
            Notification(
                user_id=dmitry.id,
                kind="news",
                room_id=channel.id,
                message_id=c2.id,
                actor_id=admin2.id,
                body="Новый пост в объявлениях",
            ),
            Notification(
                user_id=tatiana.id,
                kind="cabin_granted",
                body="Вам открыт доступ к Каюте",
            ),
            Notification(
                user_id=olga.id,
                kind="admin",
                title="Напоминание об анкете",
                body="Пожалуйста, заполните выпускную анкету экспедиции.",
            ),
            Notification(
                user_id=pavel.id,
                kind="admin",
                title="Поздравляем с окончанием экспедиции!",
                body="Ваш путь пройден — спасибо, что были с нами.",
                read_at=NOW,
            ),
        ]
        s.add_all(notifications)

        # ------------------------------------------------------------------ Cabin
        s.add_all(
            [
                CabinEntry(
                    user_id=tatiana.id,
                    kind="diary",
                    data={"mood": "спокойствие", "text": "Сегодня был продуктивный день."},
                ),
                CabinEntry(
                    user_id=tatiana.id,
                    kind="decatastrophize",
                    data={
                        "fear": "Не успею сдать задание вовремя",
                        "realistic": "Скорее всего успею, если начну заранее",
                    },
                ),
                CabinEntry(
                    user_id=tatiana.id,
                    kind="trigger",
                    data={
                        "trigger": "Критика в общем чате",
                        "hypothesis": "Связано со страхом осуждения",
                    },
                ),
            ]
        )

        # ------------------------------------------------------------------ Support: feedback + FAQ
        s.add_all(
            [
                Feedback(
                    user_id=anna.id,
                    kind="bug",
                    body="При загрузке видео иногда зависает прогресс-бар.",
                ),
                Feedback(
                    user_id=dmitry.id,
                    kind="improvement",
                    body="Было бы удобно иметь тёмную тему для мобильной версии.",
                    resolved_at=NOW,
                ),
            ]
        )
        s.add_all(
            [
                FaqItem(
                    question="Как сменить пароль?",
                    answer="Зайдите в настройки профиля и выберите «Сменить пароль».",
                    sort_order=0,
                ),
                FaqItem(
                    question="Что делать, если пропустил день в Динамике?",
                    answer="Вы можете использовать одно из трёх помилований в разделе «Динамика».",
                    sort_order=1,
                ),
            ]
        )

        # ------------------------------------------------------------------ Calendar
        s.add_all(
            [
                CalendarEvent(
                    title="Общий созвон недели",
                    description="Еженедельная встреча всей группы.",
                    starts_at=NOW + timedelta(days=2, hours=3),
                    ends_at=NOW + timedelta(days=2, hours=4),
                    created_by=admin1.id,
                ),
                CalendarEvent(
                    title="Дедлайн общей задачи",
                    starts_at=common_task.deadline_at,
                    all_day=True,
                    task_id=common_task.id,
                    created_by=admin1.id,
                ),
                CalendarEvent(
                    title="Встреча группы «Навигаторы»",
                    description="Внутренняя встреча группы для синхронизации.",
                    starts_at=NOW + timedelta(days=1, hours=5),
                    ends_at=NOW + timedelta(days=1, hours=6),
                    room_id=group.id,
                    created_by=anna.id,
                ),
            ]
        )

        await s.commit()

        # ------------------------------------------------------------------ report
        print("=== Seed complete ===")
        print(f"Users created/found: {len(users)}")
        print("\nLogin credentials (username / password):")
        for spec in users_spec:
            role_tag = f" [{spec.get('role', 'participant')}]"
            print(f"  {spec['username']} / {PASSWORD}{role_tag}")
        print("\nUse admin1 or admin2 to log in as admin.")


if __name__ == "__main__":
    _guard_local_db()
    asyncio.run(main())
