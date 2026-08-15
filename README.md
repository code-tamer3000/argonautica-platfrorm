# Платформа образовательного проекта

База знаний (материалы автора) + реалтайм-чат участников (DM, группы, каналы,
треды). Мобильный доступ — PWA.

## Стек
PostgreSQL · Redis · FastAPI (REST + WebSocket) · React/Vite (PWA) · MinIO · nginx ·
Docker Compose. Деплой — blue-green.

## Быстрый старт (dev)
1. `cp .env.example .env` и заполнить значения.
2. `docker compose -f docker/docker-compose.yml up -d` — поднимет Postgres, Redis, MinIO.
   - MinIO-консоль: http://localhost:9001
3. Backend (`backend/`): создать venv, поставить зависимости, `alembic upgrade head`, запустить uvicorn.
4. Frontend (`frontend/`): инициализировать Vite (см. `frontend/README.md`), затем `npm run dev`.

## Документация
- `CLAUDE.md` — контекст проекта и индекс документации (память для Claude Code).
- `docs/ARCHITECTURE.md` — архитектура в схемах: стек, данные по областям, ключевые
  потоки, окружения. **Отсюда стоит начинать знакомство с проектом.**
- `docs/DECISIONS.md` — журнал архитектурных решений: почему сделано именно так и что
  сломается, если «упростить».
- `docs/DATA_MODEL.md` — модель данных (источник правды по схеме).
- Остальные `docs/*.md` — по доменам, см. индекс в `CLAUDE.md`.
  Исторические документы (включая старую спецификацию) — в `docs/archive/`.

## Git-процесс
`main` (прод) / `develop` (интеграция) / `feature/*` (через PR). Прямой пуш в
`main`/`develop` запрещён. Параллельная разработка — `git worktree` на ветку.
