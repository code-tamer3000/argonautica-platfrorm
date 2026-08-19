"""Provisioning второго потока «Экспедиции»: набор, материалы БЗ, новость, FAQ,
приветственные задания.

Запускается ВНУТРИ контейнера бэкенда целевого окружения — тот же принцип, что у
`intake_bot.py`: DATABASE_URL/MINIO_* уже в env контейнера, ничего передавать не
нужно.

    docker exec -i <backend-container> python -m scripts.provision_second_intake provision \\
        --starts-on 2026-09-01 --ends-on 2026-09-28

«64 пути» на проде уже существует как опубликованная статья БЗ — этот модуль её не
создаёт, только проверяет наличие (см. `_assert_64_puti_exists`). Копия на стейдж —
задача обёртки `scripts/provision_second_intake.sh` (докер-хождение между прод- и
стейдж-контейнерами), не этого файла: один процесс видит БД/MinIO только ОДНОГО
окружения — того, чей контейнер его запустил.

Манифест грузится из `scripts/content/manifest.md` — обёртка кладёт этот файл в
контейнер (`docker cp`) ПЕРЕД запуском; путь внутри контейнера настраивается
`--manifest-path` (по умолчанию `/work/manifest.md`, см. .sh-обёртку).

Идемпотентен: перед каждой вставкой ищет существующую строку (по title/дате/тексту
вопроса) и пропускает, если она уже есть — повторный прогон ничего не дублирует.

Копирайт (новость, FAQ, второе приветственное задание) — заглушки. Пользователь
вписывает финальный текст в константы ниже перед прогоном на прод; `--allow-placeholders`
снимает защитный стоп для прогона на стейдж «как есть» (ревью текста черновиком).
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, date, datetime

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.faq import FaqItem
from app.models.intake import Intake
from app.models.kb import KbItem, KbItemMedia
from app.models.media import MediaAsset
from app.models.message import Message
from app.models.room import Room
from app.models.task import Task
from app.models.user import User
from app.services.media import _server_client, build_storage_key

# --- Копирайт: ЗАГЛУШКИ, пользователь вписывает финальный текст ------------------

_PLACEHOLDER = "TODO: вставить финальный текст"

NEWS_BODY = _PLACEHOLDER
FAQ_ITEMS: list[tuple[str, str]] = []  # [(вопрос, ответ), ...]

TASK_NAME_TITLE = "Придумай себе имя аргонавта"
TASK_NAME_BODY = (
    "Как отправишь ответ этим заданием — так и будем обращаться к тебе на "
    "платформе: в чате, в базе знаний, в уведомлениях. Напиши свой позывной "
    "одним сообщением."
)
TASK_WELCOME2_TITLE = _PLACEHOLDER
TASK_WELCOME2_BODY = _PLACEHOLDER

KB_ITEM_64_PUTI_TITLE_SUBSTR = "64 пути"
KB_ITEM_MANIFEST_TITLE = "Манифест"


def _has_placeholder() -> bool:
    texts = [NEWS_BODY, TASK_WELCOME2_TITLE, TASK_WELCOME2_BODY]
    return any(t == _PLACEHOLDER for t in texts) or not FAQ_ITEMS


async def _first_admin_id(session) -> int:
    admin_id = (
        await session.execute(
            select(User.id).where(User.role == "admin").order_by(User.id).limit(1)
        )
    ).scalar_one_or_none()
    if admin_id is None:
        raise RuntimeError("Нет ни одного admin — некому быть автором (created_by)")
    return admin_id


async def _ensure_intake(session, starts_on: date, ends_on: date) -> Intake:
    existing = (
        await session.execute(select(Intake).where(Intake.starts_on == starts_on))
    ).scalar_one_or_none()
    if existing is not None:
        print(f"  набор уже есть: id={existing.id} starts_on={existing.starts_on}")
        return existing
    intake = Intake(starts_on=starts_on, ends_on=ends_on)
    session.add(intake)
    await session.flush()
    print(f"  набор создан: id={intake.id} starts_on={starts_on} ends_on={ends_on}")
    return intake


async def _assert_64_puti_exists(session) -> None:
    found = (
        await session.execute(
            select(KbItem.id).where(KbItem.title.ilike(f"%{KB_ITEM_64_PUTI_TITLE_SUBSTR}%"))
        )
    ).scalar_one_or_none()
    if found is None:
        raise RuntimeError(
            f"Статья БЗ «{KB_ITEM_64_PUTI_TITLE_SUBSTR}» не найдена в этом окружении. "
            "На проде она должна существовать заранее; на стейдж копируется отдельным "
            "шагом (см. scripts/provision_second_intake.sh) — прогони его до этого скрипта."
        )
    print(f"  «{KB_ITEM_64_PUTI_TITLE_SUBSTR}» на месте: kb_item id={found}")


async def _create_kb_markdown_item(
    session, admin_id: int, title: str, body: str | None, raw: bytes
) -> KbItem:
    """Материал БЗ с одним .md-вложением (книга для читалки глав, см. KB.md)."""
    from app.core.config import settings  # локальный импорт — избегаем цикла на уровне модуля

    kb_item = KbItem(
        title=title,
        body=body,
        published=True,
        created_by=admin_id,
        intake_id=None,  # виден всем потокам (ARG-96)
    )
    session.add(kb_item)
    await session.flush()

    storage_key = build_storage_key("text/markdown")
    _server_client().put_object(
        Bucket=settings.minio_bucket_kb,
        Key=storage_key,
        Body=raw,
        ContentType="text/markdown",
    )
    asset = MediaAsset(
        bucket=settings.minio_bucket_kb,
        storage_key=storage_key,
        kind="file",
        mime_type="text/markdown",
        size=len(raw),
        created_by=admin_id,
    )
    session.add(asset)
    await session.flush()
    session.add(KbItemMedia(kb_item_id=kb_item.id, media_asset_id=asset.id))
    await session.flush()
    print(f"  «{title}» создан: kb_item id={kb_item.id}, "
          f"{len(raw)} байт → {settings.minio_bucket_kb}/{storage_key}")
    return kb_item


async def _ensure_manifest_kb_item(session, admin_id: int, manifest_path: str) -> KbItem:
    existing = (
        await session.execute(
            select(KbItem).where(KbItem.title == KB_ITEM_MANIFEST_TITLE)
        )
    ).scalar_one_or_none()
    if existing is not None:
        print(f"  «{KB_ITEM_MANIFEST_TITLE}» уже есть: kb_item id={existing.id}")
        return existing
    with open(manifest_path, "rb") as f:
        raw = f.read()
    return await _create_kb_markdown_item(session, admin_id, KB_ITEM_MANIFEST_TITLE, None, raw)


async def _post_news(session, admin_id: int) -> None:
    room = (
        await session.execute(select(Room).where(Room.is_news.is_(True)))
    ).scalar_one_or_none()
    if room is None:
        print("  ⚠ новостного канала ещё нет (см. ensure_news_channel) — пропуск новости")
        return
    dup = (
        await session.execute(
            select(Message.id).where(
                Message.room_id == room.id, Message.content == NEWS_BODY
            )
        )
    ).scalar_one_or_none()
    if dup is not None:
        print(f"  новость уже опубликована: message id={dup}")
        return
    msg = Message(room_id=room.id, sender_id=admin_id, content=NEWS_BODY)
    session.add(msg)
    await session.flush()
    print(f"  новость создана: message id={msg.id}")
    # Намеренно без fan_out_room_event: провижининг идёт до открытия набора, живых
    # подписчиков в канале ещё нет — участники увидят пост при обычной загрузке ленты.


async def _ensure_faq_items(session) -> None:
    for question, answer in FAQ_ITEMS:
        dup = (
            await session.execute(select(FaqItem.id).where(FaqItem.question == question))
        ).scalar_one_or_none()
        if dup is not None:
            print(f"  FAQ уже есть: {question!r}")
            continue
        session.add(FaqItem(question=question, answer=answer))
        print(f"  FAQ добавлен: {question!r}")
    if FAQ_ITEMS:
        await session.flush()


async def _ensure_welcome_task(
    session, admin_id: int, intake: Intake, title: str, body: str, *, sets_display_name: bool
) -> Task:
    existing = (
        await session.execute(
            select(Task).where(
                Task.type == "individual",
                Task.intake_id == intake.id,
                Task.title == title,
                Task.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        print(f"  задание уже есть: {title!r} (task id={existing.id})")
        return existing
    task = Task(
        type="individual",
        title=title,
        body=body,
        created_by=admin_id,
        intake_id=intake.id,
        sets_display_name=sets_display_name,
        deadline_at=datetime.combine(intake.starts_on, datetime.min.time(), tzinfo=UTC),
    )
    session.add(task)
    await session.flush()
    # Пустой список получателей — намеренно (см. intake_bot.py::_assign_intake_welcome_tasks):
    # каждый новичок этого набора получает назначение в момент регистрации.
    print(f"  задание создано (0 получателей на старте): {title!r} (task id={task.id})")
    return task


async def provision(starts_on: date, ends_on: date, manifest_path: str, allow_placeholders: bool) -> None:
    if _has_placeholder() and not allow_placeholders:
        raise SystemExit(
            "Копирайт (новость/FAQ/второе задание) ещё не заполнен константами в "
            "начале файла. Впиши финальный текст или запусти с --allow-placeholders "
            "(только для черновой проверки на стейдже — НЕ для прода)."
        )

    async with SessionLocal() as session:
        admin_id = await _first_admin_id(session)

        print("1/6 набор")
        intake = await _ensure_intake(session, starts_on, ends_on)

        print("2/6 «64 пути»")
        await _assert_64_puti_exists(session)

        print("3/6 «Манифест»")
        await _ensure_manifest_kb_item(session, admin_id, manifest_path)

        print("4/6 новость")
        await _post_news(session, admin_id)

        print("5/6 FAQ")
        await _ensure_faq_items(session)

        print("6/6 приветственные задания")
        await _ensure_welcome_task(
            session, admin_id, intake, TASK_NAME_TITLE, TASK_NAME_BODY, sets_display_name=True
        )
        await _ensure_welcome_task(
            session, admin_id, intake, TASK_WELCOME2_TITLE, TASK_WELCOME2_BODY,
            sets_display_name=False,
        )

        await session.commit()
    print("\nГотово. Проверь набор/статьи/новость/FAQ/задания глазами перед следующим шагом.")


async def export_64_puti(out_json: str, out_md: str) -> None:
    """Запускается ВНУТРИ прод-контейнера. Снимает «64 пути» + .md-вложение в файлы,
    которые обёртка (`scripts/provision_second_intake.sh`) перенесёт на стейдж
    (`docker cp` между контейнерами одного хоста, прод БД со стейджа не видна)."""
    import json

    async with SessionLocal() as session:
        kb_item = (
            await session.execute(
                select(KbItem).where(KbItem.title.ilike(f"%{KB_ITEM_64_PUTI_TITLE_SUBSTR}%"))
            )
        ).scalar_one_or_none()
        if kb_item is None:
            raise RuntimeError(f"«{KB_ITEM_64_PUTI_TITLE_SUBSTR}» не найдена на проде")

        asset = (
            await session.execute(
                select(MediaAsset)
                .join(KbItemMedia, KbItemMedia.media_asset_id == MediaAsset.id)
                .where(
                    KbItemMedia.kb_item_id == kb_item.id,
                    MediaAsset.mime_type.in_(["text/markdown", "text/x-markdown"]),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if asset is None:
            raise RuntimeError(f"У «{kb_item.title}» нет .md-вложения — нечего копировать")

        obj = _server_client().get_object(Bucket=asset.bucket, Key=asset.storage_key)
        raw = obj["Body"].read()

    with open(out_json, "w") as f:
        json.dump({"title": kb_item.title, "body": kb_item.body}, f, ensure_ascii=False)
    with open(out_md, "wb") as f:
        f.write(raw)
    print(f"экспортировано: «{kb_item.title}», {len(raw)} байт → {out_json}, {out_md}")


async def import_64_puti(in_json: str, in_md: str) -> None:
    """Запускается ВНУТРИ стейдж-контейнера — обратная половина `export_64_puti`."""
    import json

    with open(in_json) as f:
        meta = json.load(f)
    with open(in_md, "rb") as f:
        raw = f.read()

    async with SessionLocal() as session:
        existing = (
            await session.execute(
                select(KbItem).where(KbItem.title.ilike(f"%{KB_ITEM_64_PUTI_TITLE_SUBSTR}%"))
            )
        ).scalar_one_or_none()
        if existing is not None:
            print(f"«{existing.title}» уже есть на стейдже: kb_item id={existing.id} — пропуск")
            return
        admin_id = await _first_admin_id(session)
        await _create_kb_markdown_item(session, admin_id, meta["title"], meta["body"], raw)
        await session.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_provision = sub.add_parser("provision", help="набор + Манифест + новость + FAQ + задания")
    p_provision.add_argument("--starts-on", required=True, type=date.fromisoformat)
    p_provision.add_argument("--ends-on", required=True, type=date.fromisoformat)
    p_provision.add_argument("--manifest-path", default="/work/manifest.md")
    p_provision.add_argument("--allow-placeholders", action="store_true")

    p_export = sub.add_parser("export-64-puti", help="прод: снять «64 пути» в файлы")
    p_export.add_argument("--out-json", default="/work/64-puti.json")
    p_export.add_argument("--out-md", default="/work/64-puti.md")

    p_import = sub.add_parser("import-64-puti", help="стейдж: залить «64 пути» из файлов")
    p_import.add_argument("--in-json", default="/work/64-puti.json")
    p_import.add_argument("--in-md", default="/work/64-puti.md")

    args = parser.parse_args()
    if args.cmd == "provision":
        asyncio.run(
            provision(args.starts_on, args.ends_on, args.manifest_path, args.allow_placeholders)
        )
    elif args.cmd == "export-64-puti":
        asyncio.run(export_64_puti(args.out_json, args.out_md))
    elif args.cmd == "import-64-puti":
        asyncio.run(import_64_puti(args.in_json, args.in_md))


if __name__ == "__main__":
    main()
