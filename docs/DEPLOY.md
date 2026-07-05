# Деплой

Прод-стек целиком в Docker Compose. **Наружу торчит только nginx** (80/443);
Postgres/Redis/MinIO живут в docker-сети без проброса портов. Деплой —
**blue-green** (zero-downtime): две копии backend (`blue`/`green`) на одном
Postgres/Redis/MinIO, nginx переключает трафик. Миграции —
**expand/contract** (обратно-совместимые), применяются ДО переключения.

Файлы: [docker/docker-compose.prod.yml](../docker/docker-compose.prod.yml),
[docker/nginx/](../docker/nginx/), [docker/deploy.sh](../docker/deploy.sh),
[backend/Dockerfile](../backend/Dockerfile).

## Текущее окружение

| Ветка | Окружение | Сервер | Триггер деплоя |
|---|---|---|---|
| `main` | **Production** | `193.233.245.210` | merge PR → GitHub Actions автоматически |
| `develop` | — | — | CI (тесты/линт), деплоя нет |

**GitHub Actions:** [.github/workflows/deploy-prod.yml](../.github/workflows/deploy-prod.yml) — rsync кода на сервер (без `.env`, без `docker/nginx/certs/`), затем SSH → `bash docker/deploy.sh`.

**SSH-доступ к серверу** (`~/.ssh/config`):
```
Host platform
    HostName 193.233.245.210
    User root
    IdentityFile ~/.ssh/gh_actions
    IdentitiesOnly yes
```
Подключение: `ssh platform`.

## 1. Подготовка сервера (VPS)
- Ubuntu + Docker Engine + Compose plugin (`docker compose`).
- Клонировать репозиторий, `cd` в корень.
- `cp .env.example .env` и заполнить: реальные пароли Postgres/MinIO, длинный
  `JWT_SECRET` (`openssl rand -hex 32`), `DOMAIN`/`MEDIA_DOMAIN`,
  `MINIO_PUBLIC_ENDPOINT=https://${MEDIA_DOMAIN}`, `DATABASE_URL`/`REDIS_URL` на
  docker-имена (`postgres`/`redis`). `.env` НЕ коммитить.
- DNS: `DOMAIN` и `MEDIA_DOMAIN` → IP сервера.

## 2. TLS-сертификаты
nginx читает `docker/nginx/certs/${DOMAIN}.{crt,key}` и `${MEDIA_DOMAIN}.{crt,key}`.

- **Локальная проверка / стейджинг:** self-signed —
  `DOMAIN=localhost MEDIA_DOMAIN=media.localhost docker/nginx/make-self-signed.sh`.
- **Прод (Let's Encrypt):** выписать боевые серты (certbot webroot — nginx уже отдаёт
  `/.well-known/acme-challenge/` из тома `certbot_webroot`), затем разложить/симлинкнуть
  fullchain→`${DOMAIN}.crt`, privkey→`${DOMAIN}.key` (и для медиа-домена) в
  `docker/nginx/certs/`. Обновление по cron + `docker compose exec nginx nginx -s reload`.

## 3. Первый запуск
```sh
docker/nginx/make-self-signed.sh                                  # или боевые серты
docker compose -f docker/docker-compose.prod.yml --env-file .env run --rm migrate
docker compose -f docker/docker-compose.prod.yml --env-file .env up -d
```
`up` поднимает Postgres/Redis/MinIO, `backend-blue` (+`green`) и nginx (трафик → blue по
[active_backend.conf](../docker/nginx/active_backend.conf)). Проверка:
`curl -k https://${DOMAIN}/api/health`.

## 4. Деплой новой версии (blue-green)
```sh
git pull
docker/deploy.sh
```
Скрипт: собрать образ → `run --rm migrate` (expand-миграции, совместимы с живым цветом)
→ поднять второй цвет → дождаться `healthy` → переписать `active_backend.conf` →
`nginx -s reload` → дренаж WS → остановить старый цвет. Сокеты при переключении рвутся —
клиент переподключается сам.

## 5. Откат
Вернуть `active_backend.conf` на прежний цвет, `docker compose … exec nginx nginx -s reload`,
при необходимости поднять прежний контейнер (`… up -d --no-deps backend-<color>`). Старый
образ/контейнер остаётся до следующего деплоя.

## 6. Резервное копирование

Скрипт: [`docker/backup.sh`](../docker/backup.sh).

### Что делает скрипт

1. Находит контейнер `postgres` динамически через `docker compose ps -q postgres`.
2. Запускает `pg_dump` внутри контейнера, пайпит вывод через `gzip` в файл
   `/tmp/backup_YYYY-MM-DD_HH.sql.gz`.
3. Загружает архив в bucket `backups` в MinIO. Использует `mc` (MinIO client),
   при его отсутствии — fallback на `python3 + boto3`.
4. Удаляет из bucket объекты старше 30 дней (`mc rm --older-than 30d` или boto3).
5. Удаляет временный файл с диска.
6. Завершается с ненулевым кодом при любой ошибке (`set -euo pipefail`).

### Подготовка

**Сделать скрипт исполняемым** (один раз после клонирования):
```sh
chmod +x docker/backup.sh
```

**Настроить алиас `mc`** (MinIO client должен быть установлен на хосте):
```sh
mc alias set minio "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
```
Bucket `backups` создаётся скриптом автоматически при первом запуске.

Если `mc` не установлен, скрипт использует `python3 + boto3` (boto3 должен быть
доступен в системном python или в venv).

### Ручной запуск

Запускать из корня репозитория с `.env` в текущей директории:
```sh
set -a; source .env; set +a
docker/backup.sh
```

Или передать переменные явно:
```sh
POSTGRES_USER=app POSTGRES_PASSWORD=secret POSTGRES_DB=platform \
  MINIO_ENDPOINT=http://localhost:9000 \
  MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=secret \
  docker/backup.sh
```

### Настройка cron

Пример: запускать каждый день в 03:00, логировать в `/var/log/backup.log`:
```
0 3 * * * cd /path/to/repo && set -a && source .env && set +a && /path/to/repo/docker/backup.sh >> /var/log/backup.log 2>&1
```

Или если переменные уже в окружении cron-пользователя:
```
0 3 * * * /path/to/repo/docker/backup.sh >> /var/log/backup.log 2>&1
```

Проверить последний запуск: `tail -50 /var/log/backup.log`.

## Заметки
- **Только expand/contract миграции** (blue и green делят один Postgres): сначала
  add-колонка + выкатка кода, отдельным релизом — drop. Никаких RENAME/DROP в один шаг.
- **Память** (VPS 2 ядра/4 ГБ): в момент деплоя недолго живут оба цвета; `deploy.sh`
  гасит старый после переключения, в покое работает один.
- **Секреты** — только в `.env` (gitignore). Postgres/Redis/MinIO наружу не публикуются.
- **Фронт:** когда появится `frontend/dist`, смонтировать его в nginx вместо
  `docker/nginx/html` (placeholder) — location `/` уже отдаёт SPA с `try_files`.
- **Staging и 502 после деплоя.** Стенд (`deploy-staging.sh`) без blue-green: `up -d`
  ПЕРЕСОЗДАЁТ backend/frontend, и они получают новые IP в docker-сети. nginx резолвит
  имена апстримов один раз при старте и кэширует IP — поэтому после пересоздания он
  держит устаревшие адреса и отдаёт **502 на все запросы**, хотя сами контейнеры
  `healthy`. Лечится перезапуском nginx (`… restart nginx`); в `deploy-staging.sh` это
  уже делается автоматически в конце. Признак именно этой причины: `curl` к backend
  напрямую (`docker exec … :8000/api/health`) отдаёт 200, а через nginx — 502.
