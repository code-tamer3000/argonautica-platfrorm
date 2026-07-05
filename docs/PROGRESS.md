# Прогресс разработки

Журнал стадий. Что фактически реализовано и проверено, и что из этого
зависит от окружения (dev / prod). Держать в актуальном состоянии.

---

## Стадия 1 — Фундамент бэкенда (2026-06-28) ✅

Общая инфраструктура бэкенда. **Без эндпоинтов фич** — только то, на что они потом сядут.

### Реализовано
- **Конфигурация** — [backend/app/core/config.py](../backend/app/core/config.py):
  `pydantic-settings`, все переменные из `.env` (см. `.env.example`). Единый
  синглтон `settings`.
- **БД (async)** — [backend/app/db/base.py](../backend/app/db/base.py) (единый
  `Base` + naming-convention для стабильных имён constraint/index),
  [backend/app/db/session.py](../backend/app/db/session.py) (async-движок,
  `async_sessionmaker`, зависимость `get_session`).
- **Модели** — [backend/app/models/](../backend/app/models/): все 13 сущностей из
  [DATA_MODEL.md](DATA_MODEL.md) (users, rooms, room_members, messages,
  message_attachments, pinned_messages, media_assets, stickerpacks, stickers,
  kb_categories, kb_items, kb_item_media, calendar_events). SQLAlchemy 2.0 typed,
  `BIGSERIAL`, enum через `TEXT`+`CHECK`, плоские треды (self-FK на корень),
  индекс `(room_id, thread_root_id, created_at)`.
- **Миграции (Alembic async)** — [backend/alembic/](../backend/alembic/) + первая
  миграция всей схемы. URL берётся из `settings`, не из `alembic.ini`.
- **Security** — [backend/app/core/security.py](../backend/app/core/security.py):
  argon2 (`hash_password`/`verify_password`/`needs_rehash`), JWT access/refresh;
  refresh несёт `jti` под будущую ревокацию в Redis.
- **Redis** — [backend/app/core/redis.py](../backend/app/core/redis.py):
  async-клиент + проверка/закрытие в lifespan
  [backend/app/main.py](../backend/app/main.py).
- **Медиа (MinIO/S3)** — [backend/app/services/media.py](../backend/app/services/media.py):
  presigned-PUT/GET через boto3 (signature v4), `ensure_buckets`. Байты не гоняем
  через FastAPI (CLAUDE.md п.7).

### Проверено (на поднятых контейнерах)
- `alembic upgrade head` → 14 таблиц; `alembic check` → *No new upgrade operations* (модели = миграции).
- `alembic downgrade base` → 0 таблиц; повторный `upgrade head` — миграция обратима.
- Smoke: argon2 round-trip, JWT create→decode, presigned PUT/GET, Postgres `SELECT 1`, Redis `ping`.
- `ruff check` — чисто; `mypy app` (strict) — чисто.

### Ещё НЕ сделано (следующие стадии)
- `api/` (REST-роутеры), `ws/` (WebSocket + Redis pub/sub), `schemas/` (Pydantic).
- Эндпоинты auth (login/refresh/logout с ревокацией refresh-jti в Redis).
- Тесты (`pytest`), CI (зелёный — обязателен для PR), доработка `backend/Dockerfile`.
- nginx blue/green, frontend.

---

## Стадия 2 — Auth & Admin (2026-06-29) ✅

Аутентификация и закрытое заведение пользователей (регистрации нет — юзеров создаёт админ).

### Реализовано
- **Auth** — [backend/app/api/auth.py](../backend/app/api/auth.py): `login`
  (anti-enumeration: одинаковый ответ на «нет юзера»/«неверный пароль», прозрачный
  argon2-rehash), `refresh` (ротация: гасим предъявленный jti, выдаём новую пару),
  `logout` (идемпотентный отзыв), `change-password` (доступен при
  `must_change_password`), `GET /me`.
- **Сессии в Redis** — [backend/app/services/auth.py](../backend/app/services/auth.py):
  `issue_token_pair`/`refresh_is_valid`/`revoke_refresh` — refresh-`jti` хранится в
  Redis (отзыв/логаут устройств), access stateless.
- **Admin** — [backend/app/api/admin.py](../backend/app/api/admin.py): весь роутер под
  `require_admin`. `create_user` (сервер генерит одноразовый пароль, отдаёт один раз;
  `must_change_password=true`), `PATCH /users/{id}` (только whitelisted-поля).
- **Зависимости авторизации** — [backend/app/api/deps.py](../backend/app/api/deps.py):
  `get_current_user → get_current_active_user → require_admin`.

### Проверено
- Тесты: `test_auth.py`, `test_admin.py`. `ruff`/`mypy` — чисто.

---

## Стадия 3 — Комнаты и участники (2026-06-29) ✅

### Реализовано
- [backend/app/api/rooms.py](../backend/app/api/rooms.py): создание `dm` (дедуп по
  `dm_key`, гонки через `IntegrityError`), `group` (создатель — owner), `channel`
  (только admin, строк членства не плодим — вариант А); список комнат (каналы видны
  всем); управление участниками (add/remove, права owner/admin, идемпотентность,
  защита единственного owner).
- Схемы — [backend/app/schemas/room.py](../backend/app/schemas/room.py).

### Проверено
- Тесты: `test_rooms_create.py`, `test_rooms_members.py`.

---

## Стадия 4 — Сообщения и треды (2026-06-29) ✅

### Реализовано
- [backend/app/api/messages.py](../backend/app/api/messages.py) +
  [schemas/message.py](../backend/app/schemas/message.py) +
  [services/rooms.py](../backend/app/services/rooms.py) (единая проверка доступа
  `load_room`/`assert_room_access` + ленивое членство канала):
  - отправка (текст/стикер/вложения; сообщение должно нести хоть что-то),
  - лента комнаты (`thread_root_id IS NULL`, без удалённых, курсор по id),
  - **плоские треды** (привязка к корню) + denorm `reply_count`/`last_reply_at`,
  - открытый тред (корень + ответы),
  - мягкое удаление (автор/admin),
  - прочтения через `last_read_message_id` (только вперёд; для канала строка
    создаётся лениво), `unread_count` в списке комнат.

### Проверено
- Тест: `test_messages.py`. Миграции не потребовались (схема была заложена в Стадии 1).

---

## Стадия 5 — Реалтайм через WebSocket (2026-06-29) ✅

### Реализовано
- [backend/app/ws/](../backend/app/ws/): `pubsub.py` (мост Redis pub/sub,
  самостартующий слушатель `room:*`/`presence`), `manager.py` (реестр соединений,
  fanout/broadcast), `chat.py` (эндпоинт `/ws`: JWT-рукопожатие через `?token=`,
  presence через refcount в Redis, команды subscribe/unsubscribe/typing/ping,
  подписка с проверкой доступа), `schemas.py` (контракт событий).
- Интеграция: [api/messages.py](../backend/app/api/messages.py) публикует
  `message.new`/`message.deleted`/`read` в комнату. Доставка всегда через Redis
  pub/sub — слой не зависит от числа воркеров (SPEC §3.3).

### Проверено
- Тест: `test_ws.py` (через `httpx-ws`). `conftest` гасит слушателя между тестами.
- ⚠️ Прод: в nginx нужен `Upgrade`/`Connection` для `/ws` (инфра, вне кода).

---

## Стадия 6 — Загрузка медиа (presigned) (2026-06-29) ✅

### Реализовано
- [backend/app/api/media.py](../backend/app/api/media.py) +
  [schemas/media.py](../backend/app/schemas/media.py) +
  [services/media.py](../backend/app/services/media.py):
  - `POST /api/media/uploads` — валидация типа/размера (§6.4) → presigned-PUT;
    намерение загрузки в Redis (TTL 15м),
  - `POST /api/media/assets` — подтверждение: размер берётся из MinIO (`head_object`),
    не от клиента; создаётся `media_assets`,
  - `GET /api/media/{id}` — presigned-GET после `assert_media_access` (владелец или
    участник комнаты с привязанным сообщением).
- Привязка вложений в `send_message` ужесточена: прикрепить можно только свои ассеты.
- Бакеты создаются в `lifespan` (`ensure_buckets`). Лимит размера —
  `MEDIA_MAX_UPLOAD_BYTES` (100 МБ).

### Проверено
- Тест: `test_media.py` (включая реальный presigned round-trip в поднятый MinIO).

### Ещё НЕ сделано (следующие стадии)
- Rate-limiting входа/отправки/загрузок (Redis, §6.6).
- Закрепления (`pinned_messages`), редактирование сообщений (`edited_at`).
- База знаний (`kb_items`), календарь (`calendar_events`).
- CI (GitHub Actions, зелёный — обязателен для PR), `backend/Dockerfile` (прод).
- nginx (blue/green, `/ws` upgrade, раздача статики/медиа), frontend (React PWA).

---

## Стадия 7 — Закрепления и редактирование сообщений (2026-06-29) ✅

Доменная модель чата стала функционально полной: две фичи из SPEC, под которые в
Стадии 1 уже были заложены таблица и колонка, получили API. **Миграций не требует** —
схема (`pinned_messages`, `messages.edited_at`) лежит с Стадии 1, `alembic check`
остаётся чистым.

### Реализовано
- **Закрепления (SPEC §4.7)** — [backend/app/api/messages.py](../backend/app/api/messages.py):
  `POST /api/rooms/{room_id}/messages/{message_id}/pin` (идемпотентно),
  `DELETE …/pin`, `GET /api/rooms/{room_id}/pins`. Право закрепления —
  `assert_can_pin` в [services/rooms.py](../backend/app/services/rooms.py): owner
  группы / platform-admin, для dm — любой из двух участников; в канале — только admin.
  Удалённое сообщение снимается с закрепления (целостность). Список — без N+1
  (`_attachments_map`), удалённые не показываются.
- **Редактирование (SPEC §4.3)** — `PATCH /api/rooms/{room_id}/messages/{message_id}`:
  правит текст **только автор** (admin чужой текст не переписывает — в отличие от
  удаления); стикер/вложение-only править нечего → 400; проставляется `edited_at`.
- **WS-события** — [ws/schemas.py](../backend/app/ws/schemas.py): `message.edited`,
  `pin.added`, `pin.removed`; публикуются в Redis pub/sub комнаты (как `message.new`).
- Доступ к комнате проверяется на КАЖДОМ действии (CLAUDE.md п.1) через
  `load_room` + `assert_room_access`.

### Проверено
- Тесты: [tests/test_pins.py](../backend/tests/test_pins.py) (право owner/admin,
  dm-участник, идемпотентность, 404 на удалённое/несуществующее, снятие закрепления
  при удалении) + раздел редактирования в
  [tests/test_messages.py](../backend/tests/test_messages.py). `pytest -q` — 60 passed.
- `alembic check` → *No new upgrade operations* (фича не трогает БД).
- `ruff check` — чисто; `mypy app` (strict) — чисто.

> CI (lint/typecheck/test) уже настроен — [.github/workflows/ci.yml](../.github/workflows/ci.yml)
> (триггер на PR в `develop`/`main`). Пометка «CI не сделан» в Стадии 1 устарела.

---

## Стадия 8 — База знаний (Knowledge Base) (2026-06-30) ✅

Вторая половина продукта получила API: авторские материалы (markdown) с привязкой
файлов/видео и чтение опубликованного всеми участниками. **Категории — вне MVP**
(DECISIONS.md), материалы плоские (`category_id` = NULL). **Миграций не требует** —
схема (`kb_items`, `kb_item_media`) лежит с Стадии 1, `alembic check` чист.

### Реализовано
- **Авторский CRUD (только admin)** — [backend/app/api/kb.py](../backend/app/api/kb.py),
  префикс `/api/kb`: `POST /items` (по умолчанию черновик), `PATCH /items/{id}`
  (whitelist-поля, как `admin.update_user`), `DELETE /items/{id}` (явный bulk-DELETE
  связей перед материалом — иначе FK), `POST /items/{id}/media` (идемпотентная
  привязка), `DELETE /items/{id}/media/{asset_id}`. Файлы грузятся обычным media-flow
  (`/api/media/...`) и линкуются по `media_asset_id` — загрузку не дублируем.
- **Чтение (любой участник)** — `GET /items` (участник видит только `published`,
  admin — все; `media_asset_ids` без N+1) и `GET /items/{id}` (черновик для не-admin —
  404, существование не раскрываем). Доступ — [services/kb.py](../backend/app/services/kb.py)
  (`load_kb_item`/`assert_kb_item_visible`/`attached_media_ids`).
- **Доступ к медиа KB** — расширен `assert_media_access`
  ([services/media.py](../backend/app/services/media.py)): ассет, привязанный к
  **опубликованному** материалу, доступен любому участнику (presigned-GET через
  существующий `GET /api/media/{id}`). Отвязка/снятие публикации доступ закрывают.

### Проверено
- Тесты [tests/test_kb.py](../backend/tests/test_kb.py): видимость черновик/публикация,
  гейты admin-only, привязка медиа и доступ к нему по публикации, отвязка снимает
  доступ, удаление материала каскадит связи, 404 на чужой ассет. `pytest -q` — 72 passed.
  (MinIO не нужен — `MediaAsset` сидится в БД, presigned-URL подписывается локально.)
- `alembic check` → *No new upgrade operations*; `ruff`/`mypy app` (strict) — чисто.

---

## Стадия 9 — Rate-limiting + Календарь (2026-06-30) ✅

Два независимых завершающих куска бэкенда. **Миграций не требует** —
`calendar_events` заложена в Стадии 1, rate-limit схему не трогает; `alembic check`
чист.

### Реализовано
- **Rate-limiting (§6.6)** — [services/ratelimit.py](../backend/app/services/ratelimit.py):
  `enforce_rate_limit` (fixed-window счётчик в Redis, 429 + `Retry-After`) + `client_ip`
  (за nginx — первый `X-Forwarded-For`). Применён к `login` (по IP, анти-брутфорс),
  `send_message` и `request_upload` (по юзеру). Лимиты — в
  [config.py](../backend/app/core/config.py) (`rate_limit_*`, env-tunable);
  глобальный выключатель `RATE_LIMIT_ENABLED` (в тестах — off, точечно включается
  monkeypatch'ем).
- **Календарь (§4.10)** — [api/calendar.py](../backend/app/api/calendar.py) +
  [schemas/calendar.py](../backend/app/schemas/calendar.py), префикс `/api/calendar`:
  CRUD событий **только admin** (`POST/PATCH/DELETE /events`, проверка `ends_at >=
  starts_at`); чтение участниками `GET /events` (project-wide видят все; событие
  комнаты — только при доступе, та же видимость, что у списка комнат; фильтры
  `from`/`to`/`room_id`) и `GET /events/{id}` (для события комнаты — `assert_room_access`).

### Проверено
- Тесты [tests/test_ratelimit.py](../backend/tests/test_ratelimit.py) (login/send → 429
  при превышении) и [tests/test_calendar.py](../backend/tests/test_calendar.py)
  (видимость project-wide/группа/канал, admin-гейты, валидация дат, фильтр диапазона).
  `pytest -q` — 74 passed (rate-limit в наборе выключен autouse-фикстурой).
- `alembic check` → *No new upgrade operations*; `ruff`/`mypy app` (strict) — чисто.

---

## Стадия 10 — Стикерпаки + Профиль и директория (2026-06-30) ✅

Последний фич-домен бэкенда: редактирование своего профиля, директория
пользователей и стикерпаки. **Первая миграция после Стадии 1** (additive/expand,
обратима): картинки аватаров/стикеров — через media-flow, храним ссылку на ассет,
URL подписываем на чтение.

### Реализовано
- **Миграция `e10ce43ba1d3`** — `users.avatar_media_id`, `stickers.image_media_id`
  (nullable FK на `media_assets`); `stickers.image_url` стал nullable. `avatar_url`/
  `image_url` оставлены под внешний URL (приоритет у media_id). Обратима.
- **Подпись на чтение** — `presign_asset_urls` ([services/media.py](../backend/app/services/media.py)):
  батч `{asset_id: presigned-GET}` (подпись локальна, без N+1; аватары/стикеры видны
  любому участнику — без `assert_media_access`).
- **Профиль (§4.2)** — [api/auth.py](../backend/app/api/auth.py): `GET /me` (теперь с
  подписанным `avatar_url`, bio, settings) и `PATCH /me` (display_name/bio/avatar/
  settings; аватар — только свой image-ассет, иначе 403/404; `extra="forbid"`).
- **Директория** — [api/users.py](../backend/app/api/users.py): `GET /api/users`
  (список для ростера/выбора DM-пира, аватары батчем) и `GET /api/users/{id}`
  (публичный профиль без email/settings).
- **Стикерпаки (§4.5)** — [api/stickers.py](../backend/app/api/stickers.py): admin
  создаёт пак и добавляет стикеры (картинка — image-ассет, иначе 404); участники
  читают `GET /api/stickerpacks` (паки со стикерами, картинки подписаны). Удаление не
  делаем — стикеры под FK `messages.sticker_id` (снос ломает историю).

### Проверено
- Тесты [tests/test_profile.py](../backend/tests/test_profile.py) (правка профиля,
  аватар через media + снятие, чужой/не-image ассет → 403/404, директория, extra
  forbidden) и [tests/test_stickers.py](../backend/tests/test_stickers.py) (создание
  пака/стикера, чтение с подписью, admin-гейты, отправка стикер-сообщения). `pytest`
  — 82 passed.
- Миграция: `upgrade`→`downgrade -1`→`upgrade` (обратима); `alembic check` → *No new
  upgrade operations*; `ruff`/`mypy app` (strict) — чисто.

---

## Стадия 11 — Прод-инфра: докеризация + nginx + blue-green (2026-06-30) ✅

Не-фичевая стадия: прод-стек по SPEC §5/§7. Кода бэкенда не трогает. Наружу торчит
только nginx; stateful-сервисы — внутри docker-сети, общие для blue/green; деплой —
zero-downtime переключением; миграции — expand/contract. Полный runbook —
[docs/DEPLOY.md](DEPLOY.md).

### Реализовано
- **Образ бэкенда** — [backend/Dockerfile](../backend/Dockerfile) (slim, non-root,
  HEALTHCHECK на `/api/health`) + `docker-entrypoint.sh` (uvicorn, `UVICORN_WORKERS`;
  миграции — отдельным one-shot, чтобы blue+green не гонялись за `alembic upgrade`) +
  `.dockerignore`.
- **nginx** — [docker/nginx/templates/default.conf.template](../docker/nginx/templates/default.conf.template)
  (envsubst `${DOMAIN}`/`${MEDIA_DOMAIN}`): TLS, редирект 80→443 + ACME-webroot,
  `/api/` и `/ws` (Upgrade/Connection, `proxy_read_timeout 3600s`) → upstream backend,
  `/` → SPA-статика (`try_files`), отдельный server для медиа-домена → `minio:9000`
  (Host сохраняем — SigV4). Security-хедеры (HSTS и пр.). Активный цвет — в
  [active_backend.conf](../docker/nginx/active_backend.conf); `make-self-signed.sh` для
  локальных сертов; placeholder-`index.html` (до фронта).
- **Прод-compose** — [docker/docker-compose.prod.yml](../docker/docker-compose.prod.yml):
  Postgres/Redis/MinIO **без host-портов** (named volumes, healthcheck'и), one-shot
  `migrate` (profile), `backend-blue`/`backend-green`, nginx (80/443). MinIO запинен на
  релиз.
- **Blue-green деплой** — [docker/deploy.sh](../docker/deploy.sh): образ → migrate
  (expand, до переключения) → поднять второй цвет → дождаться healthy → переписать
  upstream → `nginx -s reload` → дренаж WS → стоп старого. Детект `docker compose`/
  `docker-compose`. Откат — вернуть upstream + reload.

### Проверено (локально, self-signed, без домена/VPS)
- `docker build backend/` — образ собирается; контейнер отвечает на `/api/health`.
- `nginx -t` на отрендеренном конфиге — ок; `docker compose config` валиден.
- Стек поднят на `localhost`/`media.localhost`: `curl -k https://localhost/api/health`
  → ok, `http→https` редирект, медиа-домен проксирует в MinIO, `/ws` отдаёт upgrade.
- `deploy.sh`: активный цвет в upstream меняется, трафик не прерывается.
- Боевые TLS (Let's Encrypt), реальные домен/VPS и `frontend/dist` — ручные шаги
  деплоя (DEPLOY.md), вне локальной проверки.

---

## Окружения: dev vs prod ⚠️

**Принцип.** Код один. Отличается только `.env` на конкретном сервере. **Имена**
переменных фиксированы кодом ([config.py](../backend/app/core/config.py)); **значения**
зависят от окружения. В git — только шаблон `.env.example` (без значений), реальные
`.env` со секретами не коммитятся никогда (CLAUDE.md п.9).

> Текущие dev-значения в `.env` (корень и `backend/`) — заглушки для локального
> прогона **бэкенда на хосте против контейнеров**. На проде они ДРУГИЕ.

### Переменные

| Переменная | dev (сейчас) | prod (что должно быть) |
|---|---|---|
| `DATABASE_URL` | `...@localhost:5432/...` (хост → контейнер) | имя сервиса в docker-сети или managed-Postgres; реальный пароль |
| `REDIS_URL` | `redis://localhost:6379/0` | `redis://redis:6379/0` (внутреннее имя) |
| `MINIO_ENDPOINT` | `http://localhost:9000` | внутренний адрес (`http://minio:9000`) — server-side вызовы |
| `MINIO_PUBLIC_ENDPOINT` | `http://localhost:9000` | публичный **https**-домен, который видит браузер (напр. `https://media.<домен>`) — под него подписываются presigned-URL |
| `JWT_SECRET` | заглушка | сильный секрет (`openssl rand -hex 32`), из секрет-стора, не в git |
| `POSTGRES_*`, `MINIO_ROOT_*` | заглушки | реальные креды сервера |
| `*_BUCKET_*`, `JWT_*_TTL` | как в шаблоне | по политике проекта |

Ключевой нюанс: **`MINIO_ENDPOINT` (внутренний) и `MINIO_PUBLIC_ENDPOINT` (для
браузера) на проде — разные адреса.** presigned-URL подписываются под публичный,
иначе клиент по ссылке не достучится.

### Версии (что фиксировано, что зависит от сервера)

- **Python:** `>=3.12` (pyproject). Прод-образ — `python:3.12-slim`
  ([backend/Dockerfile](../backend/Dockerfile)). Локально dev использует pyenv
  `3.12.7` (`.python-version`) — это удобство для разработчика, на прод не влияет.
- **Контейнеры** ([docker/docker-compose.yml](../docker/docker-compose.yml)):
  `postgres:16`, `redis:7` — мажор зафиксирован. **`minio:latest` НЕ зафиксирован** —
  для прод-воспроизводимости стоит закрепить конкретный релиз/digest (на прод-сервере
  может быть свой реестр/версия образа).
- **Порты** в compose открыты наружу — **только dev**. На проде убрать: наружу
  торчит только nginx, остальное — внутри docker-сети (CLAUDE.md п.9).
- **docker compose:** эта машина — `docker-compose` v1.29; прод, скорее всего,
  Compose v2 (`docker compose`). Текущий compose-файл совместим с обоими.
- **Миграции:** expand/contract (blue и green делят один Postgres) — CLAUDE.md п.8.

### Как воспроизвести проверку
```bash
# 1. Поднять stateful-сервисы (из корня репо, с реальным .env):
docker compose -f docker/docker-compose.yml --env-file .env up -d   # или docker-compose

# 2. Бэкенд (из backend/, в venv на Python 3.12):
pip install -e ".[dev]"
alembic upgrade head      # применить схему
alembic check             # модели не разошлись с миграцией
ruff check app alembic && mypy app
```

---

## Стадия 12 — Фронтенд: каркас, дизайн-система, auth, чат-ядро (2026-06-30) ✅

Первые два шага React-PWA. Стек: React 18 + TypeScript + Vite + TanStack Query v5 +
Zustand + react-router-dom v6. **Рабочий бэкенд обязателен** (Postgres + Redis + MinIO).

### Реализовано

**Фаза 1 — каркас + дизайн-система + аутентификация**
- **Точка входа** — [frontend/src/main.tsx](../frontend/src/main.tsx): QueryClientProvider
  (staleTime 15 s, retry 1, без refetchOnWindowFocus), BrowserRouter, AuthProvider, App.
- **Дизайн-система** — [frontend/src/styles/tokens.css](../frontend/src/styles/tokens.css)
  (палитра: `--color-bezdna`, `--color-more`, `--color-zoloto`; типографика: Prata/Lora/Onest;
  спейсинг, радиусы, эффекты) + [global.css](../frontend/src/styles/global.css) (сброс,
  утилиты `.col/.row/.grow/.center`).
- **Компоненты** — `Avatar`, `Button` (primary/gold/outline), `Spinner`.
- **API-слой** — [lib/apiClient.ts](../frontend/src/lib/apiClient.ts): Bearer-авторизация,
  авто-рефреш на 401 (singleton promise), `ApiError`. [lib/wsClient.ts](../frontend/src/lib/wsClient.ts):
  авто-реконнект (backoff до 15 s), ping 25 s, re-subscribe после реконнекта.
- **Типы** — [lib/types.ts](../frontend/src/lib/types.ts): все DTO бэкенда + дискриминированный
  union `WsEvent` (12 типов событий).
- **Auth** — [features/auth/](../frontend/src/features/auth/): `AuthContext` (bootstrap через
  refresh → /me), `AuthGuard`, `LoginScreen`, `ChangePasswordScreen`.
- **AppShell** — [features/app/AppShell.tsx](../frontend/src/features/app/AppShell.tsx):
  запуск WS + `useRealtime()` в корне, шапка, `<ChatLayout>`.

**Фаза 2 — чат-ядро**
- **API-хуки чата** — `useMessages` (infinite, cursor), `useSendMessage`, `useEditMessage`,
  `useDeleteMessage`, `useMarkRead` ([api/messages.ts](../frontend/src/api/messages.ts));
  `useRooms`, `useCreateRoom`, `useRoomMembers`, `useAddMember`, `useRemoveMember`
  ([api/rooms.ts](../frontend/src/api/rooms.ts)); `useUsers`, `useUsersMap`
  ([api/users.ts](../frontend/src/api/users.ts)).
- **Кэш-мутации** — [api/cache.ts](../frontend/src/api/cache.ts): `appendMessage`,
  `replaceMessage`, `removeMessage`, `bumpReplyCount`.
- **Чат-компоненты** — [features/chat/](../frontend/src/features/chat/): `ChatLayout`,
  `RoomList` (поиск, бейджи, presence), `ChatPane` (auto-mark-read), `MessageList`
  (infinite scroll), `MessageItem`, `Composer` (Enter-to-send, throttled typing), `TypingIndicator`.
- **Реалтайм** — [hooks/useRealtime.ts](../frontend/src/hooks/useRealtime.ts): маршрутизация
  WS-событий в кэш.
- **UI-стор** — [stores/ui.ts](../frontend/src/stores/ui.ts): `activeRoomId`, `typing` (4 s TTL), `online`, `dmPeers`.

### Проверено
- `npm run build` → TypeScript 0 ошибок, vite-сборка чистая.

---

## Стадия 13 — Фронтенд: вложения, стикеры, треды, закрепления (2026-06-30) ✅

Расширение чата: полная поддержка медиа, стикеров, тредов и закреплений.

### Реализовано
- **Медиа-загрузка** — [lib/mediaUpload.ts](../frontend/src/lib/mediaUpload.ts): 3-шаговый
  presigned flow (POST /uploads → PUT MinIO → POST /assets) с определением размеров изображений.
- **API-хуки** — `useMediaUrl` ([api/media.ts](../frontend/src/api/media.ts)); `usePins`,
  `usePin`, `useUnpin` ([api/pins.ts](../frontend/src/api/pins.ts)); `useThread`
  ([api/threads.ts](../frontend/src/api/threads.ts)); `useStickerpacks`, `useStickerMap`
  ([api/stickers.ts](../frontend/src/api/stickers.ts)).
- **Компонент-слой** — [components/Overlay.tsx](../frontend/src/components/Overlay.tsx):
  `Modal`, `Drawer`, `Lightbox`. [components/Toasts.tsx](../frontend/src/components/Toasts.tsx) +
  `stores/toast.ts`: императивный `toast(text, kind?)`, авто-dismiss 3.5 s.
- **Attachment** — [features/chat/Attachment.tsx](../frontend/src/features/chat/Attachment.tsx):
  presigned-GET → img/video/download-link, Lightbox по клику на фото.
- **StickerPicker** — попап с 4-колоночной сеткой стикеров по пакам.
- **MessageItem** расширен — рендеринг стикеров, `Attachment` вместо плейсхолдера,
  экшн-меню (ответить / редактировать / удалить / закрепить), inline-edit, тред-ссылка.
- **Composer** расширен — upload-кнопка, pending-чипы, стикер-picker, context-bar для ответа.
- **ChatPane** — 5 стейтов (replyTo, editingId, threadRootId, showPins, showMembers),
  кнопки 📌/👥 в хедере.
- **Панели** — `ThreadPanel` (Drawer + мини-composer), `PinsDrawer`, `MembersDrawer`.

### Проверено
- `npm run build` → TypeScript 0 ошибок, vite-сборка чистая (274 KiB JS).

---

## Стадия 14 — Фронтенд: навигация, профиль, база знаний, календарь (2026-06-30) ✅

Фаза 4: роутинг, сайдбар, читательские экраны для KB и Calendar, редактирование профиля.

### Реализовано
- **Роутинг** — [features/app/AppShell.tsx](../frontend/src/features/app/AppShell.tsx):
  `<Routes>` с путями `/`, `/kb`, `/kb/:itemId`, `/calendar`, `/profile`, `/admin/*`;
  сайдбар из `NavLink` (активный класс через `isActive`), пункт "Управление" виден только admin.
- **API-хуки KB** — [api/kb.ts](../frontend/src/api/kb.ts): `useKbItems`, `useKbItem`;
  плюс admin-мутации `useCreateKbItem`, `useUpdateKbItem`, `useDeleteKbItem`,
  `useAttachKbMedia`, `useDetachKbMedia`.
- **API-хуки календаря** — [api/calendar.ts](../frontend/src/api/calendar.ts):
  `useCalendarEvents(from?, to?)`, `useCalendarEvent(id)`;
  плюс `useCreateCalendarEvent`, `useUpdateCalendarEvent`, `useDeleteCalendarEvent`.
- **API-профиля** — [api/profile.ts](../frontend/src/api/profile.ts): `usePatchMe`
  (PATCH `/api/auth/me`).
- **KbList** — [features/kb/KbList.tsx](../frontend/src/features/kb/KbList.tsx):
  поиск по title (filter), карточки с preview 150 символов, дата, badges черновик/опубликовано
  для admin.
- **KbViewer** — [features/kb/KbViewer.tsx](../frontend/src/features/kb/KbViewer.tsx):
  `marked` + `DOMPurify` для markdown-рендеринга body, медиа-вложения через `<Attachment>`.
- **CalendarView** — [features/calendar/CalendarView.tsx](../frontend/src/features/calendar/CalendarView.tsx):
  события +90 дней от сегодня, группировка по дням (`dayLabel`), пометка событий с room.
- **ProfileScreen** — [features/profile/ProfileScreen.tsx](../frontend/src/features/profile/ProfileScreen.tsx):
  редактирование display_name, bio; загрузка аватара через `mediaUpload` → `usePatchMe`.

### Проверено
- `npm run build` → TypeScript 0 ошибок, vite-сборка чистая (349 KiB JS).

---

## Стадия 15 — Фронтенд: панель администратора (2026-06-30) ✅

Фаза 5: полная admin-панель — управление KB, событиями, стикерпаками, пользователями.

### Реализовано
- **Admin API** — [api/admin.ts](../frontend/src/api/admin.ts): `useCreateUser`
  (POST `/api/admin/users` → возвращает `one_time_password`), `usePatchAdminUser`
  (PATCH `/api/admin/users/:id` — `can_create_groups`, `role`).
- **AdminLayout** — [features/admin/AdminLayout.tsx](../frontend/src/features/admin/AdminLayout.tsx):
  защита роутом (`Navigate to="/"` для не-admin), горизонтальный sub-nav,
  `<Outlet />` для вложенных маршрутов.
- **AdminKb** — [features/admin/AdminKb.tsx](../frontend/src/features/admin/AdminKb.tsx):
  список всех материалов (черновики видны), создание/редактирование через `Modal`,
  toggle published, управление медиа (attach/detach через `mediaUpload`).
- **AdminCalendar** — [features/admin/AdminCalendar.tsx](../frontend/src/features/admin/AdminCalendar.tsx):
  полный список событий, создание/редактирование (datetime-local + ISO конвертация),
  выбор room из `useRooms()`.
- **AdminStickers** — [features/admin/AdminStickers.tsx](../frontend/src/features/admin/AdminStickers.tsx):
  список паков, создание пака, добавление стикера (upload + keyword) через `PackRow`
  (sub-компонент для корректного использования `useAddSticker(packId)`).
- **AdminUsers** — [features/admin/AdminUsers.tsx](../frontend/src/features/admin/AdminUsers.tsx):
  создание пользователя с показом одноразового пароля + copy-to-clipboard,
  редактирование role и can_create_groups.
- **Вложенные маршруты** — в AppShell: `/admin/kb`, `/admin/calendar`, `/admin/stickers`,
  `/admin/users`; index → redirect на `/admin/kb`.

### Проверено
- `npm run build` → TypeScript 0 ошибок, vite-сборка чистая (975 модулей, 370 KiB JS).

---

## Стадия 16 — UI-полировка фронтенда (2026-07-01) ✅

Шлифовка визуала и мобильной адаптивности после завершения функционала.

### Реализовано
- **Дизайн-система** — обновлены токены ([tokens.css](../frontend/src/styles/tokens.css)) и глобальные стили ([global.css](../frontend/src/styles/global.css)); переработаны модули CSS всех фич (chat, calendar, kb, profile, admin, appshell).
- **Новые компоненты** — [components/icons.tsx](../frontend/src/components/icons.tsx) (централизованные SVG-иконки); [features/chat/PinsBar.tsx](../frontend/src/features/chat/PinsBar.tsx) (панель закреплений); [hooks/useIsMobile.ts](../frontend/src/hooks/useIsMobile.ts) (адаптивный breakpoint-хук).
- **PWA-ассеты** — `apple-touch-icon.png`, `favicon.ico`, `logo1.svg`, иконки 192×192 и 512×512.
- **nginx шаблон** — доработан [docker/nginx/templates/default.conf.template](../docker/nginx/templates/default.conf.template).
- **DM и просмотр профилей** — создание DM/групп из чата, просмотр профиля участника.

### Проверено
- `npm run build` → TypeScript 0 ошибок.

---

## Стадия 17 — CI/CD и прод-деплой (2026-07-01) ✅

Полная автоматизация деплоя: `main` привязан к production-серверу через GitHub Actions.

### Реализовано
- **GitHub Actions CI** — уже был ([.github/workflows/ci.yml](../.github/workflows/ci.yml)): ruff + mypy + pytest на каждый PR в `develop`/`main`. Добавлено: тест `test_admin` обновлён под реальное поведение (`/me` доступен при `must_change_password`).
- **GitHub Actions CD** — [.github/workflows/deploy-prod.yml](../.github/workflows/deploy-prod.yml): при merge в `main` rsync синхронизирует код на сервер (без `.env`, без `docker/nginx/certs/`), затем SSH запускает `bash docker/deploy.sh` (blue-green).
- **SSH-конфиг** — алиас `ssh platform` в `~/.ssh/config` (HostName + IdentityFile); подключение без пароля.
- **Секреты GitHub** — `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER` добавлены через `gh secret set`.
- **Очистка репо** — удалены устаревшие скрипты `deploy-frontend.sh`, `deploy-to-server.sh`; удалены все локальные и remote feature-ветки (влиты в `develop`, `develop` влит в `main`).

### Текущее состояние
- **`main` → production-сервер** (`193.233.245.210`): при merge в `main` деплой запускается автоматически.
- **`develop`** — интеграционная ветка; при PR в `main` обязательно проходит CI.
- Сервер работает на self-signed сертификатах (IP); при подключении домена — заменить на Let's Encrypt.

### Проверено
- Деплой прошёл успешно: `curl -k https://193.233.245.210/api/health` → `{"status":"ok"}`.
- 93 теста, все зелёные.

---

## Стадия 18 — «Динамика»: журнал ежедневных ДЗ (2026-07-01…03) ✅

Трекинг выполнения ежедневного ДЗ по 28-дневной программе. Категории дня —
`focus`/`notes`/`film`; день **закрыт**, когда сданы все три. Ключевое решение
(DECISIONS.md): записи ДЗ — это обычные `messages` в **личной комнате-дневнике**
участника (`rooms.is_personal`), отдельной таблицы записей нет — прогресс считается
на лету.

### Реализовано
- **Миграции** — `a1b2c3d4e5f6` (`rooms.is_personal`), `f6a7b8c9d0e1`
  (`journal_pardons`), `c9d0e1f2a3b4` (`journal_credits`). Additive/expand, обратимы.
- **Модели/схемы** — [models/journal.py](../backend/app/models/journal.py)
  (`JournalPardon`, `JournalCredit`, оба с UNIQUE `(user_id, date)`),
  [schemas/journal.py](../backend/app/schemas/journal.py).
- **API** — [api/dynamics.py](../backend/app/api/dynamics.py), префикс `/api/dynamics`:
  `GET /my-stats` (закрытые дни/стрик/просрочки/окно ±дни), `POST /pardon` (помилование
  пропущенного дня, лимит `MAX_PARDONS=3`). Расчёт из сообщений личной комнаты +
  pardons/credits. Админская часть — в [api/admin.py](../backend/app/api/admin.py):
  `GET /api/admin/dynamics` (сводка по всем), `POST /api/admin/dynamics/credit`
  (ручной зачёт/снятие дня). `GET /api/rooms/{id}/journal-days` — карта
  `{дата: [категории]}` за месяц.
- **Frontend** — [features/chat/DailyJournalForm.tsx](../frontend/src/features/chat/DailyJournalForm.tsx)
  (форма сдачи ДЗ в дневнике), [features/chat/ChannelCalendar.tsx](../frontend/src/features/chat/ChannelCalendar.tsx)
  (календарь закрытых дней), [api/dynamics.ts](../frontend/src/api/dynamics.ts);
  админ-обзор [features/admin/AdminDynamics.tsx](../frontend/src/features/admin/AdminDynamics.tsx).

### Проверено
- Тест [tests/test_dynamics.py](../backend/tests/test_dynamics.py).

---

## Стадия 19 — Новости, репост, голосовые, комментарии KB (2026-07-02…03) ✅

Набор чат/контент-возможностей, накопившихся поверх ядра.

### Реализовано
- **Новостной канал** — миграция `b2c3d4e5f6a7` (`rooms.is_news`), singleton, создаётся
  в lifespan (`ensure_news_channel`). Верхнеуровневые посты — только admin; читают все.
- **Репост в новости** — миграция `e5f6a7b8c9d0` (`messages.forwarded_from_sender_id`);
  `POST /api/rooms/{id}/messages/{mid}/repost` (только admin, [api/messages.py](../backend/app/api/messages.py)):
  копия текста/стикера/вложений в новостной канал с сохранением исходного автора
  («переслано от X»).
- **Голосовые сообщения** — миграция `d4e5f6a7b8c9` (`media_assets.kind = 'audio'`);
  [features/chat/VoiceComposer.tsx](../frontend/src/features/chat/VoiceComposer.tsx) —
  запись и отправка через обычный media-flow (presigned-PUT/GET).
- **Комментарии базы знаний** — миграция `c3d4e5f6a7b8` (`kb_comments`), плоские,
  мягкое удаление (автор/admin); ручки в [api/kb.py](../backend/app/api/kb.py)
  (`GET/POST /items/{id}/comments`, `DELETE /comments/{id}`),
  [features/kb/KbComments.tsx](../frontend/src/features/kb/KbComments.tsx).

---

## Стадия 20 — Уведомления (колокольчик) (2026-07-03) ✅

Лента уведомлений в шапке + realtime-доставка. Доменные данные в Postgres (история,
переживание перезагрузки, будущий web-push).

### Реализовано
- **Миграция** `a7b8c9d0e1f2` (`notifications`): `kind` (`dm`/`reply`/`news`/
  `journal_missed`), `room_id`, nullable `message_id`/`actor_id`/`ref_date`, `read_at`;
  индекс ленты + partial-индекс непрочитанных.
- **Модель/схемы/сервис** — [models/notification.py](../backend/app/models/notification.py),
  [schemas/notification.py](../backend/app/schemas/notification.py),
  [services/notifications.py](../backend/app/services/notifications.py): `on_new_message`
  (получатели: автор корня треда для reply / второй участник dm / все для news),
  `ensure_journal_notifications`/`clear_journal_missed_notification` (системное
  «вчера дневник не закрыт»).
- **API/WS** — [api/notifications.py](../backend/app/api/notifications.py) (`GET ""`,
  `POST /read`); WS-события `notification.new`/`notification.removed` через персональный
  канал `user:{id}` в Redis pub/sub ([ws/schemas.py](../backend/app/ws/schemas.py)).
- **Frontend** — [features/app/NotificationBell.tsx](../frontend/src/features/app/NotificationBell.tsx),
  [useNavBadges.ts](../frontend/src/features/app/useNavBadges.ts),
  [useOpenNotification.ts](../frontend/src/features/app/useOpenNotification.ts),
  [api/notifications.ts](../frontend/src/api/notifications.ts).

### Проверено
- Тест [tests/test_notifications.py](../backend/tests/test_notifications.py).

---

## Стадия 21 — Раздел «Поддержка» (2026-07-03…04) ✅

Обращения участников и FAQ.

> Примечание (2026-07-05): админ-раздел «Сервер» (метрики нагрузки) удалён —
> сервис `system_metrics`, схема `metrics`, эндпоинт `GET /api/admin/metrics` и
> фронт `AdminMetrics` больше не существуют.

### Реализовано
- **Обращения** — миграция `b8c9d0e1f2a3` (`feedback`: `kind` improvement/bug, `body`,
  `resolved_at`); приём [api/feedback.py](../backend/app/api/feedback.py) (`POST`,
  любой участник), разбор в [api/admin.py](../backend/app/api/admin.py)
  (`GET /api/admin/feedback`, `PATCH /api/admin/feedback/{id}` — отметить разобранным).
- **FAQ** — миграция `d0e1f2a3b4c5` (`faq_items`); [api/faq.py](../backend/app/api/faq.py):
  чтение всеми (`GET`), CRUD только admin (`POST/PATCH/DELETE`, `sort_order`).
- **Frontend** — [features/support/SupportScreen.tsx](../frontend/src/features/support/SupportScreen.tsx)
  (FAQ + кнопки обращений), [api/faq.ts](../frontend/src/api/faq.ts),
  [api/feedback.ts](../frontend/src/api/feedback.ts); админ-экраны
  [AdminFaq](../frontend/src/features/admin/AdminFaq.tsx),
  [AdminFeedback](../frontend/src/features/admin/AdminFeedback.tsx).

---

## Стадия 22 — Раздел «Каюта» (2026-07-04) ✅

Личная психологическая проработка участника: три подраздела в одной форме-«плашке» —
дневник эмоций, протокол декатастрофизации, триггеры (построение гипотезы). Поля формы
хранятся в JSONB `data` под `kind`-дискриминатор — новое поле добавляется без миграции.
Закоммичено в `develop` (`96ccc8c` «Раздел каюта»).

### Реализовано
- **Миграция `e1f2a3b4c5d6`** — [add_cabin_entries](../backend/alembic/versions/20260704_1200_e1f2a3b4c5d6_add_cabin_entries.py):
  новая таблица `cabin_entries` (`user_id`, `kind` c CHECK, JSONB `data`, `created_at`/
  `updated_at`, индекс `(user_id, kind, created_at)`). Additive/expand, downgrade безопасен.
- **Модель/схемы** — [models/cabin.py](../backend/app/models/cabin.py),
  [schemas/cabin.py](../backend/app/schemas/cabin.py): дискриминированный union
  `DiaryData`/`TriggerData`/`DecatastrophizeData` по `kind`, валидация полей формы на входе.
- **API** — [api/cabin.py](../backend/app/api/cabin.py), префикс `/api/cabin`: список/
  создание/замена/удаление своих записей (`user_id` из токена, чужая → 404; удаление
  физическое) + админский read-only просмотр `/api/cabin/admin/{kind}` под `require_admin`.
- **Frontend** — [features/cabin/](../frontend/src/features/cabin/): `CabinScreen`,
  `cabinFields` (описание полей форм), стили; API-хуки [api/cabin.ts](../frontend/src/api/cabin.ts);
  пункт «Каюта» в навигации + маршрут `/cabin` в [AppShell](../frontend/src/features/app/AppShell.tsx).

### Проверить
- Прогнать `pytest`/`ruff`/`mypy` и `npm run build` на develop перед релизом в `main`.

---

## Стадия 23 — Telegram-бот доступа и поддержки ✅

Отдельный сервис для входа на закрытую платформу и связи с админом (регистрации в вебе
нет). Не веб-часть — long-polling worker на том же образе, что backend.

### Реализовано
- **Бот** — [backend/scripts/telegram_bot.py](../backend/scripts/telegram_bot.py):
  меню (inline keyboard) с кнопками. **Выдача/сброс пароля** — сверка Telegram-`@username`
  с логином (регистронезависимо), свежий one-time пароль (argon2-хеш в БД,
  `must_change_password=true`), ссылка + PWA-инструкция; rate-limit в Redis
  (`bot:pwd:{tg_id}`). **Канал техвопросов** — вопрос пересылается админу
  (`TELEGRAM_ADMIN_CHAT_ID`), ответ reply доставляется участнику (состояние в Redis:
  `bot:await_q:{tg_id}`, `bot:qmap:{admin_msg_id}`). Лог действий — админу в личку + stdout.
- **Транспорт** — HTTP Bot API (`getUpdates`) через httpx, при блокировке IP Telegram —
  SOCKS5/HTTP-прокси `TELEGRAM_PROXY`. Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PROXY`,
  `TELEGRAM_ADMIN_CHAT_ID`, `PLATFORM_URL` (см. `.env.example`).
- **Инфра** — сервис `bot` в [docker-compose.prod.yml](../docker/docker-compose.prod.yml)
  (тот же образ, `python -m scripts.telegram_bot`, singleton, вне blue-green, healthcheck
  отключён). На **staging не поднимается** (2-й поллер с прод-токеном сломал бы прод-бота).

### Документация
- Runbook (BotFather, прокси, запуск, диагностика) — [docs/OPERATIONS.md](OPERATIONS.md) §2.
- Решения (почему Bot API + прокси, singleton, риск username-match) — `DECISIONS.md`.
- Функциональное описание — `PLATFORM_SPEC.md` §4.18; Redis-ключи — `DATA_MODEL.md`.

---

## Стадия 24 — Каюта: админский просмотр + компактные карточки (2026-07-05) ✅

Довели раздел «Каюта» до задуманного: админ видит, как участники ведут записи
(read-only), карточки записей сделали компактными, поле «Дата» в новой записи
подставляется сегодняшним числом.

### Реализовано
- **Backend** — новый эндпоинт `GET /api/cabin/admin/users` под `require_admin`
  ([api/cabin.py](../backend/app/api/cabin.py)): список участников, у кого есть записи,
  с числом записей (`total`) и сортировкой по последней активности — для выбора участника
  в админке. Схема `AdminCabinUser` в [schemas/cabin.py](../backend/app/schemas/cabin.py).
  Просмотр самих записей — прежний `/api/cabin/admin/{kind}?user_id=`.
- **Frontend (админка)** — [AdminCabin](../frontend/src/features/admin/AdminCabin.tsx):
  чипы участников → сегменты подразделов → read-only список карточек с датой; маршрут
  `/admin/cabin` + пункт «Каюта» в [AdminLayout](../frontend/src/features/admin/AdminLayout.tsx).
  Хуки `useAdminCabinUsers`/`useAdminCabinEntries` в [api/cabin.ts](../frontend/src/api/cabin.ts).
- **Компактные карточки** — общий компонент [CabinEntryCard](../frontend/src/features/cabin/CabinEntryCard.tsx)
  (используется и в личном экране, и в админке): свёрнут по умолчанию (заголовок + сила +
  превью), разворачивается по клику. Стили уплотнены в `cabin.module.css`.
- **Авто-дата** — поле «Дата» дневника заполняется сегодняшним числом (ДД.ММ.ГГГГ) через
  `todayStr()`/флаг `today` в [cabinFields.ts](../frontend/src/features/cabin/cabinFields.ts).

### Проверено
- `pytest tests/test_cabin.py` (9 passed, +2 теста на `/admin/users`), `ruff`, `mypy`,
  фронтовый `tsc --noEmit` — зелёные.

---

> **Прочие изменения фронта, вошедшие попутно** (стадии 18–21): личные комнаты и
> новостной раздел в навигации (`/news`), создание DM/групп через модалки
> ([NewChatModal](../frontend/src/features/chat/NewChatModal.tsx),
> [NewGroupModal](../frontend/src/features/chat/NewGroupModal.tsx)), просмотр профиля
> участника ([UserProfileModal](../frontend/src/features/chat/UserProfileModal.tsx)),
> меню действий над сообщением ([MessageActionsMenu](../frontend/src/features/chat/MessageActionsMenu.tsx),
> [useMessageMenu](../frontend/src/features/chat/useMessageMenu.tsx)), удаление комнат
> (`GET`/`DELETE` в [api/rooms.py](../backend/app/api/rooms.py),
> [tests/test_rooms_delete.py](../backend/tests/test_rooms_delete.py)).
