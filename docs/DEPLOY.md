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
- **A deploy must *recreate* prod nginx, not just reload it.** nginx resolves the hostnames in `upstream {}` **once, at config load**, and caches the IPs; `nginx -s reload` (all `deploy.sh` does) does not refresh them. The new color comes up with a **new** container IP, so right after the switch nginx keeps dialling the dead container and returns **502 for all of `/api/` and `/ws`** until someone recreates it — a full API outage that leaves the SPA shell (static, served by the `frontend` container) answering 200, so a naive "is the site up" check misses it. Observed on the 15.08 15:32 UTC deploy: blue came up on `172.18.0.10`, nginx kept hitting `172.18.0.5` (`connect() failed (113: No route to host)`). `deploy-staging.sh` already handles this with `--force-recreate`; prod's `deploy.sh` is in the "do not touch" list, so `deploy-prod.yml` does the recreate (plus a smoke-check through the edge) as its own step after the script.
- **`docker/nginx/active_backend.conf` is server state, not code.** It records which color currently serves prod, and `deploy.sh` rewrites it on every deploy. The tracked copy is only a **seed for a fresh server** (and the file `make local-up` needs locally) — `deploy-prod.yml` therefore excludes it from the main `rsync --delete` and pushes it separately with `--ignore-existing`. Without that exclusion the sync resets the pointer to the committed color *before* `deploy.sh` reads it, so the script mistakes the live color for the idle one and **recreates the container that is serving traffic** — a 502 window on `/api/` instead of zero-downtime, with the prod color pinned to one side forever. Symptom in the deploy log: `>> active=<X>, deploying → <Y>` where `<Y>` is the color that was actually already live.

## The one rule that constrains schema work

**Migrations are expand/contract only.** Blue and green share one Postgres, so old and new code must both work against the schema during a switch. Never rename/drop a column in the same release that stops writing it: add + ship code first, drop in a later release. (Column renames = add new + copy + later drop.) This is why every migration in this repo is additive.

## Environments

| Branch | Environment | Server | Trigger |
|---|---|---|---|
| `main` | Production | `193.233.245.210` (`platform.argonautica-systems.ru`) | merge → GitHub Actions (`deploy-prod.yml`) → rsync + `docker/deploy.sh` |
| `develop` | Staging | same host, `/opt/platform-staging`, **`https://staging.argonautica-systems.ru`**, isolated compose project behind the prod gateway | push → `Deploy → staging` → `deploy-staging.sh` |
| PR (any) | — | — | CI: ruff + mypy + pytest (`ci.yml`) |

- Staging is isolated (separate compose project, own network/volumes/`.env`/`JWT_SECRET`), no blue-green, **no `bot` service** (a second long-poller on the prod token would break the prod bot — see [TELEGRAM_BOT.md](TELEGRAM_BOT.md)).
- **Gateway, not a second port:** staging-nginx publishes nothing to the host — it's an internal HTTP (no TLS) reverse proxy in front of the stand's own backend/frontend/MinIO. The **prod** nginx owns a `server_name ${STAGING_DOMAIN}` block on the standard `:443` and proxies into it. The two compose projects reach each other over an `external: true` docker network named `gateway`, created once by hand (`docker network create gateway`) and declared in both `docker-compose.prod.yml` and `docker-compose.staging.yml`. `proxy_pass` on the prod side uses a `resolver 127.0.0.11` + `set $staging_upstream ...` so prod nginx doesn't fail to (re)start if the staging container happens to be down.
- **Domain & TLS:** staging answers only on `staging.argonautica-systems.ru` (access by raw IP is closed by the prod catch-all `default_server`). A-record → `193.233.245.210` (same host as prod, same port `:443` — one gateway serves both, routed by SNI/Host, not by port). Real **Let's Encrypt** cert, issued/renewed via **webroot through prod's `:80`** (prod nginx already serves `/.well-known/acme-challenge/` from the shared `docker_certbot_webroot` volume), same as before — but the cert itself now lives with **prod**, in `docker/nginx/certs/${STAGING_DOMAIN}.{crt,key}`, since prod-nginx is the one terminating TLS for the staging domain. The **host** certbot (v0.40) is broken, so issuance/renewal run in the `certbot/certbot` **container**. Renewal + delivery: `docker/nginx/renew-staging-cert.sh` (installed on the server as `/opt/platform/renew-staging-cert.sh`, cron twice-daily) renews, copies the cert into `docker/nginx/certs/`, and **recreates prod nginx** (not staging nginx).
- **`MINIO_PUBLIC_ENDPOINT` no longer carries a port** (`https://staging.argonautica-systems.ru`). Now that staging sits behind the standard `:443`, the signed Host matches what staging-nginx forwards with plain `Host $host` — the old `Host $http_host` port-preservation hack (needed only for the nonstandard `:8443`) is gone.
- Known staging gotcha: after `up -d` recreates containers they get new IPs; nginx caches upstream IPs → 502 until nginx is recreated. `deploy-staging.sh` runs `up -d --force-recreate nginx` for exactly this — and `--force-recreate` (not `restart`) is also required so envsubst re-renders the template after a config change. This is now separate from — and does not replace — recreating **prod** nginx if the staging-facing block in its own template changed.

## Marketing site (`argonautica-systems.ru`)

The apex domain is **not** the platform — it's the static marketing одностраничник, served by the *same* prod gateway.

- **Content + container:** files live on the server in `/root/argonautica-site`; a standalone `nginx:alpine` container `argonautica-site` (started by hand, `--restart unless-stopped`, joined to the `gateway` network, **no host ports**) serves them, with its config at `/root/argonautica-site.nginx.conf`. It is *not* part of any compose project — `deploy.sh` neither touches nor restarts it.
- **Static only.** The page has PHP files next to it (`send.php`, `poll.php`, `lead_ingest.php`, `config*.php`), but no PHP runtime is installed and the JS bundle calls none of them. The site's own nginx returns **404** for `*.php`, dotfiles, `*.db|sqlite|md|sh|log|ini|sql` — without that, `config*.php` (bot token) would be served as plain text.
- **Gateway block:** prod's template owns `server_name argonautica-systems.ru www.argonautica-systems.ru` with `resolver` + `set $site_upstream` lazy resolution, same pattern as staging. The domain is **hardcoded** there (unlike `${DOMAIN}`/`${STAGING_DOMAIN}`) because prod compose passes no variable for it; `make local-up` therefore self-signs a local `argonautica-systems.ru` cert so the block doesn't crash-loop the local nginx.
- **TLS:** own Let's Encrypt cert (`argonautica-systems.ru` + `www`), issued via webroot through prod's `:80`, renewed by `/root/renew-argo-cert.sh` (cron twice daily) which installs it into `docker/nginx/certs/` and **recreates prod nginx**.
- Failure mode to recognize: no apex block → apex falls into the `:443` catch-all, which answers with the **platform** cert and `return 444`. Browser shows «невозможно установить безопасное соединение» / HSTS warning, not a 404. This is what happened when a deploy re-rendered the template from the repo over a hand-added block.

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

**nginx** (`docker/nginx/templates/` only — `docker/nginx-staging/templates/` has no `:443`
block at all, it's plain HTTP behind prod): each `:443` server block gains `listen 443 quic`
next to `listen 443 ssl` (h3 is *additive* — h2/h1 keep working), plus `ssl_protocols TLSv1.2
TLSv1.3` (TLSv1.3 is mandatory for QUIC) and an `Alt-Svc` header that tells the browser to
re-connect over UDP. Two rules that will bite:

- **`reuseport` exactly once per address:port** in the whole config. Prod has four `:443`
  blocks (app, media, staging, catch-all), so it lives only in the catch-all `default_server`;
  the others declare bare `quic`.
- **`Alt-Svc` must sit where it is actually emitted.** nginx drops inherited `add_header`s in
  any location that defines its own — so the media `location /` (which sets `Cache-Control`)
  needs its own `Alt-Svc`, or that origin never advertises h3.

**Firewall:** nothing to open by hand. The host has `ufw` inactive and `iptables` `INPUT ACCEPT`
with no UDP rules; publishing the port in compose is what installs Docker's DNAT.

Only **prod** nginx publishes the UDP port (`"443:443/udp"`) — staging-nginx publishes
nothing at all (it's internal-only, proxied by prod, see "Environments" above), so it
neither terminates TLS nor advertises h3 itself; `Alt-Svc 'h3=":443"'` for the staging
domain is emitted by prod's staging-facing server block, same port as everything else.

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
