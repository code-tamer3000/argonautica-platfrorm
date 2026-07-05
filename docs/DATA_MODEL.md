# Модель данных — Платформа образовательного проекта

> Статус: проектирование. Версия 0.1.
> Дополняет PLATFORM_SPEC.md. Описывает структуру БД (PostgreSQL): сущности, поля,
> связи, а также то, что сознательно НЕ хранится в БД (эфемерное состояние в Redis).

---

## Соглашения

- **id** — `BIGSERIAL` (автоинкрементный bigint), первичный ключ.
  Выбор в пользу последовательных id, а не UUID, осознанный: на нём держится
  механизм статусов прочтения (см. раздел «Статусы прочтения»), которому нужна
  монотонность id.
- **Временные метки** — `TIMESTAMPTZ` (со временной зоной), `created_at` по
  умолчанию `now()`.
- **Строки** — `TEXT` (в Postgres нет смысла ограничивать длину без причины).
- **Enum-поля** — `TEXT` с `CHECK`-ограничением на список значений (или нативный
  Postgres ENUM — на усмотрение при реализации).
- **Мягкое удаление** — где применимо, поле `deleted_at` (`NULL` = живое).
  Физически строки не удаляем.
- **FK** — все внешние ключи с явными ограничениями ссылочной целостности.

---

## Сущности

### users
Пользователи. Профиль = поля личного кабинета.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| email | TEXT, UNIQUE, NOT NULL | логин |
| password_hash | TEXT, NOT NULL | argon2 / bcrypt, никогда не plaintext |
| display_name | TEXT, NOT NULL | отображаемое имя |
| avatar_url | TEXT, NULL | аватар пользователя |
| bio | TEXT, NULL | о себе |
| role | TEXT, NOT NULL, default `'participant'` | `'participant'` \| `'admin'` |
| can_access_cabin | BOOLEAN, NOT NULL, default `false` | доступ к разделу «Каюта»; по умолчанию закрыт, админ выдаёт вручную (у admin — всегда) |
| settings | JSONB, NOT NULL, default `'{}'` | настройки кабинета (тема, предпочтения) — без миграций под новые ключи |
| created_at | TIMESTAMPTZ, NOT NULL | |
| updated_at | TIMESTAMPTZ, NOT NULL | |

---

### rooms
Одна сущность на три типа пространств. Различия типов — это поведение в коде, а не
разная структура.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| type | TEXT, NOT NULL | `'dm'` \| `'group'` \| `'channel'` |
| name | TEXT, NULL | NULL для dm |
| avatar_url | TEXT, NULL | аватар группы/канала; для dm не хранится (берётся аватар собеседника) |
| dm_key | TEXT, UNIQUE, NULL | только для dm: канонический ключ пары `"minUserId:maxUserId"`, защищает от дублей личных чатов |
| created_by | BIGINT FK users, NOT NULL | |
| created_at | TIMESTAMPTZ, NOT NULL | |
| is_personal | BOOLEAN, NOT NULL, default false | личная комната-дневник участника (раздел «Динамика»): сюда падают ежедневные записи ДЗ |
| is_news | BOOLEAN, NOT NULL, default false | новостной канал платформы (singleton); верхнеуровневые посты — только admin |

---

### room_members
Несёт две вещи: **членство** (кто в комнате) и **состояние чтения**.

| Поле | Тип | Описание |
|------|-----|----------|
| room_id | BIGINT FK rooms | |
| user_id | BIGINT FK users | |
| role_in_room | TEXT, NOT NULL, default `'member'` | `'owner'` \| `'member'` |
| joined_at | TIMESTAMPTZ, NOT NULL | |
| last_read_message_id | BIGINT FK messages, NULL | до какого сообщения дочитал (см. статусы прочтения) |
| is_muted | BOOLEAN, NOT NULL, default false | |

**PK:** (`room_id`, `user_id`).

**Каналы — вариант А (неявный доступ).** Для каналов строки членства НЕ создаются
на всех. Видимость канала = правило «пользователь является участником платформы →
видит все каналы», оно в коде, не в таблице. Строка в `room_members` для канала
появляется **лениво** — когда юзер впервые открыл канал, и только чтобы хранить
`last_read_message_id`. Это исключает массовые вставки и рассинхрон.

Следствие для проверки доступа: «состоит ли юзер в комнате» зависит от типа —
для `dm`/`group` это «есть ли строка», для `channel` это «он участник платформы».

---

### messages
Центральная таблица. Сюда же ложатся треды.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | монотонный — важно для статусов прочтения |
| room_id | BIGINT FK rooms, NOT NULL | |
| sender_id | BIGINT FK users, NOT NULL | |
| content | TEXT, NULL | текст; NULL, если сообщение это только стикер/вложение |
| thread_root_id | BIGINT FK messages, NULL | NULL = верхний уровень; заполнено = ответ в треде, указывает на корень |
| sticker_id | BIGINT FK stickers, NULL | если сообщение — стикер |
| forwarded_from_sender_id | BIGINT FK users, NULL | репост в новостной канал: исходный автор (атрибуция «переслано от X»); NULL = обычное сообщение |
| reply_count | INT, NOT NULL, default 0 | денормализовано на корневом сообщении |
| last_reply_at | TIMESTAMPTZ, NULL | денормализовано на корневом сообщении |
| created_at | TIMESTAMPTZ, NOT NULL | |
| edited_at | TIMESTAMPTZ, NULL | |
| deleted_at | TIMESTAMPTZ, NULL | мягкое удаление |

**Треды (одноуровневые, стиль Slack):**
- `thread_root_id IS NULL` -> сообщение верхнего уровня, лежит в ленте комнаты.
- `thread_root_id = X` -> ответ внутри треда под сообщением X.
- **Правило плоскости:** ответ никогда не ссылается на другой ответ. При ответе на
  сообщение, которое само является ответом, берётся не его id, а его
  `thread_root_id` — привязка всегда к корню. Вложенности нет по построению.

**Запросы:**
- Лента комнаты: `room_id = X AND thread_root_id IS NULL AND deleted_at IS NULL`.
- Открытый тред: `thread_root_id = <id корня>` (+ сам корень).

**Денормализация:** `reply_count` и `last_reply_at` хранятся на корневом сообщении,
обновляются при добавлении ответа — чтобы показывать «N ответов» без пересчёта.

**Рекомендуемый индекс:** (`room_id`, `thread_root_id`, `created_at`).

---

### media_assets
Централизованное хранилище метаданных всех файлов. Сами байты лежат в **MinIO**
(S3-совместимое объектное хранилище). Сообщения и база знаний ссылаются сюда.
Смысл абстракции: смена бэкенда хранения (локальный MinIO -> managed S3) трогает
**одно** место, т.к. API везде S3-совместимый.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| bucket | TEXT, NOT NULL | бакет MinIO (напр. `chat-media`, `kb-media`) |
| storage_key | TEXT, NOT NULL | ключ объекта в бакете (напр. `2026/06/<uuid>.mp4`) |
| thumb_key | TEXT, NULL | ключ превью: картинки — сервер ужимает оригинал; видео — постер-кадр, снятый клиентом при загрузке. NULL — превью нет (файлы, старые/битые записи) |
| kind | TEXT, NOT NULL | `'image'` \| `'video'` \| `'file'` \| `'audio'` (голосовые сообщения) |
| mime_type | TEXT, NOT NULL | |
| size | BIGINT, NOT NULL | байты |
| width | INT, NULL | для изображений/видео |
| height | INT, NULL | для изображений/видео |
| duration | INT, NULL | секунды, для видео |
| created_by | BIGINT FK users, NOT NULL | |
| created_at | TIMESTAMPTZ, NOT NULL | |

**Публичный URL не хранится.** Файлы приватные; доступ — через **presigned URL**,
который бэкенд генерирует на лету при чтении, предварительно проверив, что юзер
имеет доступ к соответствующему сообщению/комнате/материалу. Ссылка
короткоживущая. Это согласовано с принципом «авторизация на каждом запросе».

**Потоки работы с файлами:**
- *Загрузка* (особенно видео): бэкенд валидирует (тип, размер, доступ) и выдаёт
  **presigned-PUT** — клиент льёт файл напрямую в MinIO, минуя FastAPI (не гоняем
  видео через приложение). После подтверждения создаётся строка `media_assets`.
- *Чтение*: бэкенд выдаёт **presigned-GET** на время (24 ч — длинный TTL для кэша).
  Видео — с поддержкой HTTP range-запросов (перемотка), MinIO это умеет.
- *Превью*: в ленте отдаётся лёгкий thumbnail (`thumb_key`), оригинал — только по
  клику/скачиванию. Best-effort: сбой не роняет загрузку (`thumb_key` = NULL → грузится
  оригинал). Два пути генерации:
  - *картинки* — при подтверждении загрузки бэкенд один раз тянет оригинал из MinIO,
    ужимает (Pillow, WebP, ≤1024px) и кладёт рядом;
  - *видео* — постер-кадр снимает **клиент** при загрузке (canvas → WebP) и льёт
    отдельным объектом; сервер тянуть видеофайл ради кадра не станет (дорого, против
    п.7). В `confirm` клиент передаёт `thumb_storage_key`; сервер проверяет намерение
    загрузки этого ключа (тот же user, kind image) и подхватывает его как `thumb_key`.
    Постер играет и как `poster` у `<video>` (нет чёрного прямоугольника до плея).
  - *старые записи без превью* дозаполняются разовым скриптом
    `backend/scripts/backfill_thumbnails.py` (только картинки; см. OPERATIONS.md).
- *Доставка в ленте*: presigned-URL вложений (оригинал + превью) встраиваются прямо в
  payload сообщений (`MessageOut.attachments`), а не запрашиваются по одному на ассет —
  убирает N лишних round-trip'ов (критично на мобиле). Доступ гейтится комнатой.

---

### message_attachments
Связь «многие-ко-многим»: одно сообщение -> несколько вложений.

| Поле | Тип | Описание |
|------|-----|----------|
| message_id | BIGINT FK messages | |
| media_asset_id | BIGINT FK media_assets | |

**PK:** (`message_id`, `media_asset_id`).

---

### pinned_messages
Закреплённые сообщения. Отдельная таблица (а не флаг на сообщении) — чтобы держать
несколько закреплённых, знать порядок и кто закрепил.

| Поле | Тип | Описание |
|------|-----|----------|
| room_id | BIGINT FK rooms | |
| message_id | BIGINT FK messages | |
| pinned_by | BIGINT FK users | |
| pinned_at | TIMESTAMPTZ, NOT NULL | |

**PK:** (`room_id`, `message_id`). Право закреплять — owner комнаты / admin.

---

### stickerpacks
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| name | TEXT, NOT NULL | |
| created_by | BIGINT FK users | admin |
| created_at | TIMESTAMPTZ, NOT NULL | |

### stickers
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| pack_id | BIGINT FK stickerpacks | |
| image_url | TEXT, NOT NULL | картинка стикера |
| keyword | TEXT, NULL | для поиска/подстановки |
| sort_order | INT, NOT NULL, default 0 | |

Паки добавляет только admin. Сообщение-стикер: `content = NULL`, `sticker_id`
заполнен.

---

### База знаний

**kb_categories** — *на вырост (вне MVP)*. Группировка разделов.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| title | TEXT, NOT NULL | |
| sort_order | INT, NOT NULL, default 0 | |

**kb_items** — материалы автора.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| category_id | BIGINT FK kb_categories, NULL | NULL = плоский список (MVP) |
| title | TEXT, NOT NULL | |
| body | TEXT, NULL | markdown |
| published | BOOLEAN, NOT NULL, default false | черновик / опубликовано |
| created_by | BIGINT FK users | admin |
| sort_order | INT, NOT NULL, default 0 | |
| created_at | TIMESTAMPTZ, NOT NULL | |
| updated_at | TIMESTAMPTZ, NOT NULL | |

**kb_item_media** — файлы/видео материала (через общую media_assets).

| Поле | Тип | Описание |
|------|-----|----------|
| kb_item_id | BIGINT FK kb_items | |
| media_asset_id | BIGINT FK media_assets | |

**PK:** (`kb_item_id`, `media_asset_id`).

**kb_comments** — плоские комментарии участников под материалом.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| kb_item_id | BIGINT FK kb_items, NOT NULL | |
| author_id | BIGINT FK users, NOT NULL | |
| body | TEXT, NOT NULL | |
| created_at | TIMESTAMPTZ, NOT NULL | |
| deleted_at | TIMESTAMPTZ, NULL | мягкое удаление (п.6); удалять — автор или admin |

**Индекс:** (`kb_item_id`, `created_at`) — лента комментариев материала.

---

### calendar_events
| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| title | TEXT, NOT NULL | |
| description | TEXT, NULL | |
| starts_at | TIMESTAMPTZ, NOT NULL | |
| ends_at | TIMESTAMPTZ, NULL | |
| all_day | BOOLEAN, NOT NULL, default false | |
| room_id | BIGINT FK rooms, NULL | NULL = общее событие проекта; заполнено = событие комнаты/канала |
| created_by | BIGINT FK users | обычно admin |
| created_at | TIMESTAMPTZ, NOT NULL | |

---

### Динамика (журнал ежедневных ДЗ)

Раздел **«Динамика»** — трекинг выполнения ежедневного ДЗ по 28-дневной программе.
Категории дня: `focus`, `notes`, `film`; **день закрыт**, когда сданы все три.

**Сами записи ДЗ — это сообщения** в личной комнате-дневнике участника
(`rooms.is_personal = true`), отдельной таблицы записей нет. Прогресс (закрытые дни,
стрик, просрочки) считается на лету из сообщений + двух таблиц-исключений ниже.

**journal_pardons** — «помилования»: участник сам прощает себе пропущенный день
(лимит `MAX_PARDONS = 3`).

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK users, NOT NULL | |
| date | DATE, NOT NULL | прощённый день |
| used_at | TIMESTAMPTZ, NOT NULL | |

**UNIQUE:** (`user_id`, `date`) — один прощённый день не дублируется.

**journal_credits** — ручной зачёт дня админом: день считается закрытым (сдал не через
форму, сбой по времени и т.п.). Без лимита, в отличие от помилований.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK users, NOT NULL | кому зачтён день |
| date | DATE, NOT NULL | зачтённый день |
| granted_by | BIGINT FK users, NOT NULL | админ, поставивший зачёт |
| granted_at | TIMESTAMPTZ, NOT NULL | |

**UNIQUE:** (`user_id`, `date`).

---

### notifications
Лента уведомлений участника (колокольчик в шапке). Доменные данные (нужна история,
переживание перезагрузки, будущий web-push), поэтому Postgres, а не Redis — п.5
CLAUDE.md про эфемерку касается typing/presence/токенов, не журнала уведомлений.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK users, NOT NULL | получатель |
| kind | TEXT, NOT NULL, CHECK | `'dm'` \| `'reply'` \| `'news'` \| `'journal_missed'` \| `'cabin_granted'` |
| room_id | BIGINT FK rooms, NULL | комната источника (для `journal_missed` — личный дневник); NULL у `cabin_granted` (нет комнаты) |
| message_id | BIGINT FK messages, NULL | сообщение-источник; NULL для системных (`journal_missed`, `cabin_granted`) |
| actor_id | BIGINT FK users, NULL | кто вызвал (автор сообщения); NULL для системных |
| ref_date | DATE, NULL | для `journal_missed` — какой день не закрыт (дедуп) |
| created_at | TIMESTAMPTZ, NOT NULL | |
| read_at | TIMESTAMPTZ, NULL | NULL = непрочитано |

**Индексы:** (`user_id`, `id`) — лента; partial по (`user_id`) `WHERE read_at IS NULL` —
счётчик непрочитанных. Генерация — `services/notifications.py` в транзакции отправки
сообщения; доставка в реальном времени — персональный канал `user:{id}` в Redis
pub/sub (WS-события `notification.new` / `notification.removed`). `cabin_granted` —
системное уведомление «админ открыл доступ к Каюте» (без комнаты/автора), создаётся
`notify_cabin_granted` на переходе `users.can_access_cabin` false→true; клик ведёт в `/cabin`.

---

### Поддержка (feedback, faq)

**feedback** — обращения из раздела «Поддержка» (предложить улучшение / сообщить об
ошибке). Создаёт участник, разбирает админ в «Управлении».

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK users, NOT NULL | автор (из токена, не из тела) |
| kind | TEXT, NOT NULL, CHECK | `'improvement'` \| `'bug'` |
| body | TEXT, NOT NULL | текст обращения |
| created_at | TIMESTAMPTZ, NOT NULL | (индекс — лента для админа, сначала новые) |
| resolved_at | TIMESTAMPTZ, NULL | NULL, пока админ не отметил «разобрано» |

**faq_items** — частые вопросы раздела «Поддержка». Ведёт админ, читают участники.

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| question | TEXT, NOT NULL | |
| answer | TEXT, NOT NULL | ответ/инструкция |
| sort_order | INT, NOT NULL, default 0 | ручной порядок (меньше — выше; при равенстве по id) |
| created_at | TIMESTAMPTZ, NOT NULL | |
| updated_at | TIMESTAMPTZ, NOT NULL | |

---

### cabin_entries
Раздел **«Каюта»** — личная психологическая проработка участника. Три подраздела
(`kind`): дневник эмоций, протокол декатастрофизации, триггеры (построение гипотезы).
У всех подразделов одна форма-«плашка», но набор полей отличается — поэтому поля формы
лежат в **JSONB `data`**, а не в отдельных колонках/таблицах на каждый подраздел
(добавить/поменять поле формы — без миграции; три таблицы-близнеца не нужны).
Структура `data` под каждый `kind` валидируется на входе (Pydantic-схемы в
`app/schemas/cabin.py`).

| Поле | Тип | Описание |
|------|-----|----------|
| id | BIGSERIAL PK | |
| user_id | BIGINT FK users, NOT NULL | автор записи (берётся из токена, не от клиента) |
| kind | TEXT, NOT NULL, CHECK | `'diary'` \| `'decatastrophize'` \| `'trigger'` |
| data | JSONB, NOT NULL | поля формы подраздела; структура зависит от `kind` |
| created_at | TIMESTAMPTZ, NOT NULL | |
| updated_at | TIMESTAMPTZ, NOT NULL | `onupdate=now()` |

**Индекс:** (`user_id`, `kind`, `created_at`) — лента подраздела владельца (его записи
одного kind, сначала новые).

**Приватность.** Запись видит её автор; правку/удаление делает только автор. Админ
может просматривать записи участников (как в «Динамике»/«Поддержке») — отдельные
`/api/cabin/admin/...` под `require_admin`: `admin/users` (участники с записями +
`total` для выбора в админке) и `admin/{kind}?user_id=` (записи участника). Это
доменные данные (Postgres), не эфемерка.

**Доступ к разделу.** Личные эндпоинты `/api/cabin/{kind}` под зависимостью
`require_cabin_access` — раздел закрыт, пока `users.can_access_cabin=false` (у admin
доступ есть всегда). Админ выдаёт доступ через `PATCH /api/admin/users/{id}`
(`can_access_cabin=true`); на переходе false→true участнику создаётся уведомление
`cabin_granted`. Фронт прячет пункт навигации и маршрут `/cabin` без доступа.

**Удаление — физическое** (исключение из общего мягкого удаления п.6 CLAUDE.md):
каюта личная, восстанавливать психо-заметку смысла нет.

---

## Статусы прочтения (без отдельной таблицы)

Кто просмотрел сообщение, а кто нет — выводится из **одного числа**
`last_read_message_id` в `room_members`, без таблицы на каждую пару юзер×сообщение.

Поскольку `messages.id` монотонно растёт:
- «непрочитанные для юзера в комнате» = сообщения с `id > last_read_message_id`;
- «кто прочитал сообщение M» = участники, у кого `last_read_message_id >= M.id`.

Когда юзер читает комнату, его `last_read_message_id` двигается вперёд. Так
закрываются и счётчик непрочитанных, и галочки «просмотрено» одним механизмом.

---

## Эфемерное состояние (Redis, НЕ в Postgres)

Не всё хранится в БД. Короткоживущее реалтайм-состояние живёт в Redis:

- **«Печатает...»** — событие «юзер X печатает в комнате Y», живёт пару секунд.
  Идёт по WebSocket, в Redis с коротким TTL. В БД не пишется.
- **Presence** — кто сейчас онлайн.
- **Refresh-токены / сессии** — для возможности отзыва и логаута устройств
  (TTL и быстрый отзыв из коробки). Access-токены не хранятся нигде (stateless).
- **Счётчики rate-limit** — лимиты на вход, отправку сообщений и т.п.
- **Состояние Telegram-бота** (§4.18 SPEC) — только в Redis: `bot:pwd:{tg_id}` (rate-
  limit выдач пароля), `bot:await_q:{tg_id}` (ждём следующее сообщение как техвопрос,
  TTL), `bot:qmap:{admin_msg_id}` = chat_id спросившего (доставить ответ админа reply'ем).

---

## Карта связей

```
users --< room_members >-- rooms
users --< messages (sender) >-- rooms
messages --+ (thread_root_id -> messages.id, само на себя)
messages --< message_attachments >-- media_assets
messages --> stickers --> stickerpacks
rooms --< pinned_messages >-- messages
rooms --< calendar_events            (room_id nullable)
users --< cabin_entries              (личные записи; data в JSONB по kind)
users --< journal_pardons            (помилования пропущенных дней ДЗ)
users --< journal_credits            (ручные зачёты дней админом)
users --< notifications              (лента колокольчика; actor/message nullable)
users --< feedback                   (обращения в «Поддержку»)
faq_items                            (справочник «Поддержки», ведёт admin)
kb_items --< kb_item_media >-- media_assets
kb_items --< kb_comments >-- users   (комментарии участников, мягкое удаление)
kb_items --> kb_categories           (category_id nullable, на вырост)
media_assets                         (общая для сообщений и базы знаний)
```

> Записи ДЗ «Динамики» — это `messages` в личной комнате (`rooms.is_personal`);
> отдельной таблицы записей нет, прогресс считается из сообщений + pardons/credits.

---

## Зафиксированные решения

- Каналы — **вариант А** (неявный доступ, ленивые строки только под read-state).
- Статусы прочтения — через `last_read_message_id`, без таблицы прочтений.
- «Печатает», presence, сессии, rate-limit — в **Redis**, не в Postgres.
- Закрепление — отдельная таблица `pinned_messages` (несколько закреплённых).
- Удаление сообщений — **мягкое** (`deleted_at`).
- Медиа — централизованно в `media_assets`, байты в **MinIO** (S3-совместимо);
  приватный доступ через presigned URL, генерируемый после проверки прав.
- Аватары: пользователя (`users.avatar_url`) и комнаты (`rooms.avatar_url`); для
  dm аватар комнаты не хранится.
- Дедуп личных чатов — через `rooms.dm_key` (UNIQUE).
- id — `BIGSERIAL` (нужно для монотонности статусов прочтения).
- Категории базы знаний — структура заложена, но **на вырост**.
- «Каюта» — поля формы подразделов в **JSONB `data`** (один `kind`-дискриминатор,
  без таблиц-близнецов); удаление физическое (исключение из мягкого).
- «Динамика» — записи ДЗ хранятся как `messages` в личной комнате (`is_personal`),
  отдельной таблицы нет; прогресс считается на лету + `journal_pardons`/`journal_credits`.
- Новостной канал — `rooms.is_news` (singleton); репост в него — копия сообщения с
  `forwarded_from_sender_id` (атрибуция исходного автора).
- Уведомления, обращения «Поддержки» и FAQ — доменные данные в Postgres (нужна
  история/статус), а не эфемерка (п.5 касается typing/presence/токенов).
- Комментарии базы знаний (`kb_comments`) — мягкое удаление (п.6).
- Медиа получили `kind = 'audio'` — голосовые сообщения.
