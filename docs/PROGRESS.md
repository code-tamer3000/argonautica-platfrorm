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
