# Прод-образ бэкенда. Slim + non-root. Миграции — отдельным one-shot (см. compose),
# в рантайме контейнера только uvicorn (blue+green не должны гонять alembic параллельно).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Манифест + исходники пакета нужны, чтобы собрать и поставить `app` с зависимостями.
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

# Миграции (alembic не входит в wheel — packages=["app"]) и entrypoint.
COPY alembic ./alembic
COPY alembic.ini ./
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
