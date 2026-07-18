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
| `develop` | Staging | same host, `/opt/platform-staging`, **`https://staging.argonautica-systems.ru:8443`**, isolated compose project | push → `Deploy → staging` → `deploy-staging.sh` |
| PR (any) | — | — | CI: ruff + mypy + pytest (`ci.yml`) |

- Staging is isolated (separate compose project, own network/volumes/`.env`/`JWT_SECRET`), no blue-green, **no `bot` service** (a second long-poller on the prod token would break the prod bot — see [TELEGRAM_BOT.md](TELEGRAM_BOT.md)).
- **Domain & TLS:** staging answers only on `staging.argonautica-systems.ru` (nginx `server_name = ${DOMAIN}`; access by raw IP is closed). A-record → `193.233.245.210` (same host as prod; prod stays on `:443`, staging on `:8443` — one IP serves both, no conflict). Real **Let's Encrypt** cert, issued/renewed via **webroot through prod's `:80`** (prod nginx already serves `/.well-known/acme-challenge/` from the shared `docker_certbot_webroot` volume). The **host** certbot (v0.40) is broken, so issuance/renewal run in the `certbot/certbot` **container** against an isolated `/opt/platform-staging/letsencrypt`. Renewal + delivery: `docker/nginx-staging/renew-cert.sh` (installed on the server as `/opt/platform-staging/renew-staging-cert.sh`, cron twice-daily) renews, copies the cert into `docker/nginx-staging/certs/${DOMAIN}.crt/.key`, and **recreates** staging nginx.
- **`MINIO_PUBLIC_ENDPOINT` must carry the `:8443` port** (`https://staging.argonautica-systems.ru:8443`). The backend signs presigned MinIO URLs with the port, so the nginx MinIO location proxies `Host $http_host` (not `$host`, which drops the port) — otherwise MinIO returns `SignatureDoesNotMatch` and **all uploads fail**. (Prod is on standard `:443`, where this is moot.)
- Known staging gotcha: after `up -d` recreates containers they get new IPs; nginx caches upstream IPs → 502 until nginx is recreated. `deploy-staging.sh` runs `up -d --force-recreate nginx` for exactly this — and `--force-recreate` (not `restart`) is also required so envsubst re-renders the template after a config change.

## Local dev vs prod

- One codebase; only `.env` differs per environment. Names are fixed in `backend/app/core/config.py`; values are per-env. Dev compose (`docker/docker-compose.yml`) exposes ports and runs backend/frontend on the host (see CLAUDE.md commands).
- Key nuance: `MINIO_ENDPOINT` (internal, server-side calls) and `MINIO_PUBLIC_ENDPOINT` (browser-facing, used to sign presigned URLs) are **different addresses** in prod.

## Video transcode worker

Server-side video transcoding (see [FILES.md](FILES.md) "Video transcode") needs a **worker process** running the same backend image (ffmpeg is already in `backend/Dockerfile`). It is a `transcode-worker` service in all three composes (dev, staging, prod), reusing the `&backend` anchor — same image/env/deps, no host ports, healthcheck disabled (not an HTTP server).

**`deploy.sh` does not touch it** (it is a singleton pulling from the Redis queue, outside blue-green), so after a deploy that changes the backend image it keeps running the *old* image until restarted by hand:

```bash
cd /opt/platform && docker compose -f docker/docker-compose.prod.yml --env-file .env up -d --no-deps transcode-worker
```

Notes: one worker is enough (it processes one job at a time by design; scale with `--scale transcode-worker=N` only if the queue backs up). If the worker is missing entirely, uploads still succeed — videos just queue forever and the original is served, **silently, with no error surfaced**. If ffmpeg is missing from the image, jobs fail and videos fall back to the original (never lost).

## HTTP/3 (QUIC) + host network tuning

Aimed at the slow/far last mile (mobile, Москва↔ЕС): QUIC removes head-of-line blocking and
cuts handshake round-trips, which matters most for **media** — the measured bottleneck
(see [FILES.md](FILES.md), and note it is the *uplink*, not the backend).

**Host sysctl** (applied, `/etc/sysctl.d/90-argonautica-net.conf` — a drop-in; `/etc/sysctl.conf`
is left alone):

```
net.core.default_qdisc = fq          # was fq_codel; fq pairs with BBR's pacing
net.ipv4.tcp_congestion_control = bbr # was already on, set in /etc/sysctl.conf:70
net.core.rmem_max = 16777216         # was 212992 — far too small for QUIC
net.core.wmem_max = 16777216         # QUIC's UDP path has no kernel autotuning like TCP
```

Apply with `sysctl --system`. The big UDP buffers are the part that actually matters for h3:
unlike TCP, QUIC gets no kernel receive-buffer autotuning, so the 208 KB default caps throughput.

**nginx** (`docker/nginx/templates/`, `docker/nginx-staging/templates/`): each `:443` server
block gains `listen 443 quic` next to `listen 443 ssl` (h3 is *additive* — h2/h1 keep working),
plus `ssl_protocols TLSv1.2 TLSv1.3` (TLSv1.3 is mandatory for QUIC) and an `Alt-Svc` header
that tells the browser to re-connect over UDP. Two rules that will bite:

- **`reuseport` exactly once per address:port** in the whole config. Prod has three `:443`
  blocks, so it lives only in the catch-all `default_server`; the others declare bare `quic`.
- **`Alt-Svc` must sit where it is actually emitted.** nginx drops inherited `add_header`s in
  any location that defines its own — so the media `location /` (which sets `Cache-Control`)
  needs its own `Alt-Svc`, or that origin never advertises h3.

**Firewall:** nothing to open by hand. The host has `ufw` inactive and `iptables` `INPUT ACCEPT`
with no UDP rules; publishing the port in compose is what installs Docker's DNAT.

Both composes publish the UDP port (`"443:443/udp"` on prod, `"8443:443/udp"` on staging).
Note staging advertises `h3=":8443"`, not `:443` — `Alt-Svc` names the port the *client* dials.

**`deploy.sh` alone cannot apply an nginx change.** It only runs `nginx -s reload`, which:
- **cannot change published ports** — that needs the container recreated;
- **does not re-render the template** — `envsubst` runs only in the image entrypoint at
  container *start*, so a reload re-reads the previously rendered `conf.d/`, not your edit.

So after any change to `docker/nginx/templates/` or the nginx ports, recreate the container
(a couple of seconds of downtime — do it deliberately, not as part of a routine deploy):

```bash
cd /opt/platform && docker compose -f docker/docker-compose.prod.yml --env-file .env up -d --no-deps --force-recreate nginx
```

Always `nginx -t` the candidate **before** recreating — a running nginx holds its old config,
so a broken template on disk is harmless until restart, but a restart with one takes prod down.
Validate in a throwaway container, without touching the running nginx:

```bash
# upload the candidate to /tmp/h3check/templates/ first
docker run --rm --network docker_default \
  -e DOMAIN=... -e MEDIA_DOMAIN=... \
  -v /tmp/h3check/templates:/etc/nginx/templates:ro \
  -v /opt/platform/docker/nginx/active_backend.conf:/etc/nginx/active_backend.conf:ro \
  -v /opt/platform/docker/nginx/certs:/etc/nginx/certs:ro \
  --entrypoint /bin/sh nginx:1.27 -c \
  "/docker-entrypoint.d/20-envsubst-on-templates.sh >/dev/null 2>&1; nginx -t"
```

The `--network docker_default` matters: without it `nginx -t` fails on
`host not found in upstream "backend"`, which is a DNS artifact, not a config error.
On prod `DOMAIN == MEDIA_DOMAIN`, so `conflicting server name ... ignored` warnings are
expected — the separate media vhost is shadowed there (media is served path-style by the app
vhost) and exists for the split-domain setup.

Verify (system `curl` on the host has no HTTP/3 support; use an image that does):

```bash
curl -sSI --http2 https://<host>/ | grep -i alt-svc
docker run --rm ymuski/curl-http3 curl -sSI --http3-only https://<host>/   # expect: HTTP/3 200
```

## Backups

`docker/backup.sh` (cron, daily) — `pg_dump | gzip` → MinIO bucket `backups`, 30-day retention. Runbook in archived DEPLOY §6.
