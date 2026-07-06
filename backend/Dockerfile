# Прод-образ бэкенда. Slim + non-root. Миграции — отдельным one-shot (см. compose),
# в рантайме контейнера только uvicorn (blue+green не должны гонять alembic параллельно).
#
# Multi-stage: `base` = the full prod image content; `test` = base + pinned dev
# tooling (used only by docker-compose.test.yaml, build target: test); `runtime`
# is the DEFAULT (last) stage so target-less builds (prod/staging compose) resolve
# to the clean prod image and never to `test`.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# ffmpeg — для одноразового бэкфилла постеров старых видео (scripts/backfill_video_posters.py).
# В горячем пути видео на бэкенд не гоняем (постер снимает клиент при загрузке, CLAUDE.md п.7);
# это чисто админ-инструмент для записей, залитых до появления постеров.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Манифест + исходники пакета нужны, чтобы собрать и поставить `app` с зависимостями.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

# Миграции (alembic не входит в wheel — packages=["app"]) и entrypoint.
COPY alembic ./alembic
COPY alembic.ini ./
# Служебные скрипты (bulk-создание юзеров, telegram-бот) — запускаются в этом же образе.
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Непривилегированный пользователь.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Health без curl (нет в slim) — лёгкая проверка /api/health питоном.
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).status==200 else 1)"

ENTRYPOINT ["docker-entrypoint.sh"]

# --- test: hermetic test/CI image = prod base + PINNED dev tooling ------------
# Built on demand (docker-compose.test.yaml, target: test). NOT the final stage,
# so a target-less build never ships pytest/ruff/mypy into prod.
FROM base AS test
USER root
COPY requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
USER appuser

# --- runtime: DEFAULT stage = the prod image (identical to base) --------------
# Must stay LAST so prod/staging builds (no --target) resolve here, not to test.
FROM base AS runtime
