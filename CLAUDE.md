# CLAUDE.md — Контекст проекта

Постоянная память проекта для Claude Code. Читается в начале каждой сессии.
Держать кратким и актуальным. Детали — в `docs/`.

## Что это
Платформа для образовательного проекта: **база знаний** (материалы автора) +
**реалтайм-чат** участников (личные чаты, группы, каналы, треды под сообщениями).
~20–30 активных пользователей. Мобильный доступ — **PWA** (без нативных приложений).

## Стек
- **PostgreSQL** — БД (SQLAlchemy async + Alembic).
- **Redis** — pub/sub между воркерами + всё эфемерное состояние.
- **FastAPI** — бэкенд: REST (`/api`) + WebSocket (`/ws`).
- **React + Vite** — фронт, собирается как PWA.
- **MinIO** — медиа (S3-совместимо), доступ через presigned URL.
- **nginx** — прокси, HTTPS, переключатель blue/green.
- Всё в **Docker Compose**. Деплой — **blue-green** (zero-downtime).

## Структура монорепо
- `backend/` — FastAPI. `app/` (core, db, models, schemas, api, ws, services),
  `alembic/` (миграции), `tests/`.
- `frontend/` — React + Vite (`src/`: api, components, features, hooks, lib).
- `docker/` — compose-файлы, nginx-конфиг.
- `docs/` — PLATFORM_SPEC.md, DATA_MODEL.md, DECISIONS.md.
- `CLAUDE.md` — этот файл.

## Ключевые правила (НЕ нарушать)
1. **Авторизация на каждом запросе.** Любое чтение/действие в комнате проверяет
   членство и роль на сервере. Никогда не доверять id/room_id от клиента (IDOR — для
   чата угроза №1).
2. **Треды плоские.** Ответ всегда привязан к `thread_root_id` корня, никогда к
   другому ответу. При ответе на ответ берём его `thread_root_id`, не его id.
3. **Каналы — неявный доступ (вариант А).** Строки `room_members` для каналов не
   создаём на всех; лениво, только чтобы хранить `last_read_message_id`. Видимость
   канала — правило в коде («участник платформы видит все каналы»), не данные.
4. **Статусы прочтения — через `last_read_message_id`**, без таблицы прочтений.
   Поэтому id сообщений — монотонный `BIGSERIAL`, не UUID.
5. **Эфемерное состояние — только в Redis**, не в Postgres: «печатает», presence,
   refresh-токены/сессии, счётчики rate-limit.
6. **Мягкое удаление** сообщений (`deleted_at`), не физическое.
7. **Медиа — через `media_assets` + MinIO.** Бакеты приватны; доступ — presigned URL
   после проверки прав. Загрузка/чтение напрямую клиент↔MinIO (presigned-PUT/GET),
   НЕ гонять файлы через FastAPI.
8. **Миграции обратно-совместимые (expand/contract).** Требование blue-green: blue и
   green делят один Postgres. Никаких RENAME/DROP колонки в один шаг — сначала add +
   выкатить код, потом отдельным релизом drop.
9. **Секреты — только в `.env`** (в `.gitignore`), никогда в git. Postgres/Redis/
   MinIO не публиковать наружу — снаружи торчит только nginx.

## Конвенции кода
**Backend:** Python 3.12+, async везде (async SQLAlchemy, async-эндпоинты). Типизация
обязательна. Pydantic — для схем запросов/ответов. Раскладка: `models/` (SQLAlchemy),
`schemas/` (Pydantic), `api/` (роутеры REST), `ws/` (WebSocket), `services/`
(бизнес-логика, в т.ч. работа с MinIO), `core/` (config, security/JWT, redis).
S3-клиент — boto3 (работает с MinIO, упрощает будущий переезд на managed-S3).

**Frontend:** React + TypeScript. UI — строго по дизайн-системе проекта. Клиент
обязан уметь **переподключение WebSocket** (при blue-green деплое сокеты рвутся).

## Git-процесс
- `main` (прод) / `develop` (интеграция) / `feature/*` (по фиче, через PR).
- Прямой пуш в `main`/`develop` запрещён; PR + зелёный CI обязательны.
- Параллельная разработка — `git worktree` на каждую feature-ветку.

## Запуск (dev)
1. `cp .env.example .env`, заполнить значения.
2. `docker compose -f docker/docker-compose.yml up -d` — postgres, redis, minio.
3. Backend: `alembic upgrade head`, затем uvicorn.
4. Frontend: в `frontend/` — `npm install && npm run dev`.

## Документы
- `docs/PLATFORM_SPEC.md` — полная спецификация (функции, инфра, безопасность).
- `docs/DATA_MODEL.md` — таблицы, поля, связи, эфемерное состояние.
- `docs/DECISIONS.md` — лог принятых решений.
