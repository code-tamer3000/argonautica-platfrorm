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
