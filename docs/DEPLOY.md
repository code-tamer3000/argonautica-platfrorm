# Deploy (reference — what NOT to touch)

> Source: docs/archive/{DEPLOY.md, PLATFORM_SPEC.md §5/§7, DECISIONS.md, OPERATIONS.md}, restructured 2026-07-06.
> Agents rarely change deploy. This is the minimum to avoid breaking it. Full runbooks are in docs/archive/{DEPLOY.md, OPERATIONS.md}.

## Do NOT touch (from an agent task)

- `docker/docker-compose.prod.yml`, `docker/docker-compose.staging.yml`
- `docker/deploy.sh`, `docker/deploy-staging.sh`, `docker/backup.sh`
- `docker/nginx/**`, `docker/nginx-staging/**`, and any `certs/`
- `.env` and `.env.*` (secrets — never commit; only `.env.example` is tracked)
- `.github/workflows/*` unless the task is explicitly about CI/CD

## Topology

- Only **nginx** is exposed (80/443). Postgres/Redis/MinIO live in the docker network with no host ports. Everything in Docker Compose.
- **Blue-green** (zero-downtime): two backend copies (`blue`/`green`) share one Postgres/Redis/MinIO. nginx flips traffic. Stateful services are never duplicated.

## The one rule that constrains schema work

**Migrations are expand/contract only.** Blue and green share one Postgres, so old and new code must both work against the schema during a switch. Never rename/drop a column in the same release that stops writing it: add + ship code first, drop in a later release. (Column renames = add new + copy + later drop.) This is why every migration in this repo is additive.

## Environments

| Branch | Environment | Server | Trigger |
|---|---|---|---|
| `main` | Production | `193.233.245.210` (`platform.argonautica-systems.ru`) | merge → GitHub Actions (`deploy-prod.yml`) → rsync + `docker/deploy.sh` |
| `develop` | Staging | same host, `/opt/platform-staging`, port **8443**, isolated compose project | push → `Deploy → staging` → `deploy-staging.sh` |
| PR (any) | — | — | CI: ruff + mypy + pytest (`ci.yml`) |

- Staging is isolated (separate compose project, own network/volumes/`.env`/`JWT_SECRET`), no blue-green, **no `bot` service** (a second long-poller on the prod token would break the prod bot — see [TELEGRAM_BOT.md](TELEGRAM_BOT.md)).
- Known staging gotcha: after `up -d` recreates containers they get new IPs; nginx caches upstream IPs → 502 until nginx restarts (`deploy-staging.sh` restarts it automatically).

## Local dev vs prod

- One codebase; only `.env` differs per environment. Names are fixed in `backend/app/core/config.py`; values are per-env. Dev compose (`docker/docker-compose.yml`) exposes ports and runs backend/frontend on the host (see CLAUDE.md commands).
- Key nuance: `MINIO_ENDPOINT` (internal, server-side calls) and `MINIO_PUBLIC_ENDPOINT` (browser-facing, used to sign presigned URLs) are **different addresses** in prod.

## Backups

`docker/backup.sh` (cron, daily) — `pg_dump | gzip` → MinIO bucket `backups`, 30-day retention. Runbook in archived DEPLOY §6.
