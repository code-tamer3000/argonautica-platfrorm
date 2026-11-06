# Выпускная книга (graduation book)

Подарок после выпускной анкеты ([SURVEY.md](SURVEY.md)): личная PDF-книга «путь через
экспедицию» — дневник по дням, генные замки по стихиям, ответы на задания.
**Генерация офлайн, вне платформы**: скрипты в `scripts/graduation_book/` запускаются
вручную админом, готовые PDF заливаются в платформу через существующий механизм подарка.
Почему так — ADR-041 в [DECISIONS.md](DECISIONS.md).

## Поток данных

```
прод-БД (ssh, read-only) → export2.py → markdown → render2.py (Jinja2 + WeasyPrint) → <username>.pdf
→ админка /admin/survey → загрузка пачкой (матч по имени файла) / PATCH /api/admin/survey/gift/{user_id}
```

Дальше платформа сама: `GET /api/survey/gift` отдаёт presigned-ссылку, см. SURVEY.md.

## Что читают скрипты

`users` (+`plans`), `messages` личной комнаты дневника, `message_attachments` +
`media_assets`, `task_assignments` + `task_submissions` + `tasks`, `task_stream_texts`,
`expedition_locks`.

**Каюта (`cabin_entries`) не читается и не должна** — это приватный психологический
дневник ([CABIN.md](CABIN.md)). Любой новый запрос в скриптах — проверять на это.
Оговорка: защита только на уровне запросов; личное, что человек сам написал в дневнике
или в сдаче задания, в книгу попадёт.

## Запуск

Из `scripts/graduation_book/`. Нужен ssh-доступ к прод-хосту; БД открывается только на
чтение через `docker exec psql`. Зависимости: `weasyprint`, `jinja2`, `pillow`,
`fonttools` (venv — свой, в репо не лежит).

```bash
python3 export2.py                      # markdown по участникам
python3 render2.py --user <username>    # одна книга
python3 render2.py --user <username> --html-only   # только HTML для отладки вёрстки
```

Переменные окружения (все необязательны):

| Переменная | По умолчанию | Что |
|---|---|---|
| `GRADUATION_PRIVATE_DIR` | `~/private/byubye_artefact` | куда писать результат; читать фото из `photos_draft/` |
| `GRADUATION_SSH_HOST` | `platform-new` | ssh-алиас прод-хоста |
| `GRADUATION_DB_CONTAINER` | `docker-postgres-1` | контейнер Postgres на хосте |
| `GRADUATION_DB_USER` / `GRADUATION_DB_NAME` | `app` / `platform` | |
| `GRADUATION_INTAKE_ID` | `2` | какой поток выгружать |

## Приватные данные — не в репозитории

**Репозиторий публичный.** Ни имён, ни username'ов, ни номеров ключей участников в нём
быть не должно — только код.

Всё, что выходит из скриптов (markdown, HTML, PDF, фото участников, любой `pg_dump`),
живёт в `GRADUATION_PRIVATE_DIR` (права `700`) и **никогда не коммитится**. В репо только
код, шаблон `templates/book.html.j2`, шрифты, бумага, глифы стихий, стили.

Конфиги с данными людей — тоже там, в `$GRADUATION_PRIVATE_DIR/config/`:

| Файл | Формат | Что |
|---|---|---|
| `names.json` | `{"<username>": "Имя на титуле"}` | как подписать книгу (иначе ник) |
| `keys.json` | `{"<username>": {"keys": {"air": 7}}}` | номера ключей вручную, приоритет над БД |
| `manual_keys.json` | `{"<username>|<element>": 55}` | номера, найденные в тексте сдачи (v2) |

Нет файла — считается пустым. Админы-участники для v1: `GRADUATION_EXTRA_USERNAMES=a,b`.

## Грабли схемы

- **Личные комнаты дневника не 1:1.** `rooms.is_personal=true` имеет 8–21 строк в
  `room_members`; владельца брать по `rooms.created_by`, не по членству.
- **Записи дневника — это `messages`** с маркером `<!--journal:<key>-->`
  ([DYNAMICS.md](DYNAMICS.md)); заголовок уже внутри текста.
- **Какой генный замок выпал** — нет структурного поля; он в прозе сдачи элементного
  задания. Номер ключа берётся из `expedition_locks`, а где его нет — из `MANUAL_KEYS`
  (ручная сверка по тексту; неоднозначные случаи намеренно не резолвятся).
- `task_submissions` хранит историю — актуальна последняя строка на `assignment_id`.
  Колонка `body`.
- Турнир-«поток» хранится в `task_stream_texts`, не в `task_submissions` ([TASKS.md](TASKS.md)).

## Известные ограничения (на момент ARG-181)

`export2.py` / `render2.py` привязаны к потоку №2: id элементных заданий (`ELEMENT_TASKS`),
комната `PALUBA_ROOM_ID`, `MANUAL_KEYS` по конкретным людям, фильтр тарифов
(`Игрок`, `Спецотряд`). Параметризован только `GRADUATION_INTAKE_ID`. Для потока №3 их
нужно вынести в конфиг потока — отдельная задача. `render2.py` — «черновая вёрстка»,
`--user` обязателен (пакетного режима нет). Скрипты 1-го потока (`export.py`,
`render.py`, ходят в docker-контейнер с дампом) оставлены как есть; их подробное описание
удалено вместе с персональными данными.
