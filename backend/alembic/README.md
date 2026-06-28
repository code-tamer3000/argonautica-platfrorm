# Alembic — миграции

Инициализировать: `alembic init -t async alembic` (async-шаблон), затем настроить
`env.py` на async-движок и `DATABASE_URL` из окружения.

ВАЖНО: только обратно-совместимые миграции (expand/contract) — см. CLAUDE.md, п.8.
