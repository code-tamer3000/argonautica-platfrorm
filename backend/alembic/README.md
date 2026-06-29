# Alembic — миграции

Настроен на **async**-движок. URL берётся из окружения
(`app.core.config.settings.database_url`), а не из `alembic.ini` — секреты не в git.
`env.py` импортирует `app.models`, поэтому `Base.metadata` видит все таблицы.

Команды (из каталога `backend/`, при активном виртуальном окружении):

- `alembic upgrade head` — применить миграции.
- `alembic downgrade -1` / `alembic downgrade base` — откатить.
- `alembic revision --autogenerate -m "..."` — сгенерировать новую миграцию по моделям.
- `alembic check` — убедиться, что модели не разошлись с миграциями.

ВАЖНО: только обратно-совместимые миграции (expand/contract) — см. CLAUDE.md, п.8.
Никаких RENAME/DROP колонки в один шаг: сначала add + выкатить код, потом отдельным
релизом drop (blue и green делят один Postgres).
