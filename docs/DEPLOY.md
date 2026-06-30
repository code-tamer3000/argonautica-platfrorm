# Деплой

Прод-стек целиком в Docker Compose. **Наружу торчит только nginx** (80/443);
Postgres/Redis/MinIO живут в docker-сети без проброса портов. Деплой —
**blue-green** (zero-downtime): две копии backend (`blue`/`green`) на одном
Postgres/Redis/MinIO, nginx переключает трафик. Миграции —
**expand/contract** (обратно-совместимые), применяются ДО переключения.

Файлы: [docker/docker-compose.prod.yml](../docker/docker-compose.prod.yml),
[docker/nginx/](../docker/nginx/), [docker/deploy.sh](../docker/deploy.sh),
[backend/Dockerfile](../backend/Dockerfile).

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

## Заметки
- **Только expand/contract миграции** (blue и green делят один Postgres): сначала
  add-колонка + выкатка кода, отдельным релизом — drop. Никаких RENAME/DROP в один шаг.
- **Память** (VPS 2 ядра/4 ГБ): в момент деплоя недолго живут оба цвета; `deploy.sh`
  гасит старый после переключения, в покое работает один.
- **Секреты** — только в `.env` (gitignore). Postgres/Redis/MinIO наружу не публикуются.
- **Фронт:** когда появится `frontend/dist`, смонтировать его в nginx вместо
  `docker/nginx/html` (placeholder) — location `/` уже отдаёт SPA с `try_files`.
