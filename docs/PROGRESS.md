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
