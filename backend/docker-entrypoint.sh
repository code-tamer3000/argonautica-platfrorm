#!/bin/sh
set -e

# Если переданы аргументы (напр. compose-сервис migrate: `alembic upgrade head`) —
# выполняем их. Иначе поднимаем сервер. Миграции НЕ запускаем здесь: blue и green
# делят один Postgres, гонять `alembic upgrade` из обоих нельзя — это отдельный
# one-shot `migrate` (expand/contract, до переключения трафика).
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${UVICORN_WORKERS:-2}"
