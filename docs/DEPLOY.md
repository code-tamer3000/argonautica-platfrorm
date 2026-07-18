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

## Video transcode worker (apply to prod manually)

Server-side video transcoding (see [FILES.md](FILES.md) "Video transcode") needs a **worker process** running the same backend image (ffmpeg is already in `backend/Dockerfile`). Dev has it as the `transcode-worker` service in `docker/docker-compose.yml`. **Prod is applied manually by the user** — add a service to `docker/docker-compose.prod.yml` reusing the `&backend` anchor (shares image/env/deps, no host ports, not part of blue-green):

```yaml
  transcode-worker:
    <<: *backend
    command: ["python", "-m", "app.worker.transcode"]
    healthcheck:
      disable: true   # not an HTTP server, like the bot service
```

Notes: one worker is enough (it processes one job at a time by design; scale with `--scale transcode-worker=N` only if the queue backs up). No migration or nginx change is tied to it — the columns ship via the normal expand migration. If ffmpeg is ever missing from the image, transcoding jobs fail and videos fall back to serving the original (never lost).

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

**Prod is applied manually by the user** — `docker/docker-compose.prod.yml` is off-limits to
agent tasks, and without the UDP publish h3 stays dark (clients silently keep using h2):

```yaml
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"   # HTTP/3
```

Staging already carries `"8443:443/udp"`. Note staging advertises `h3=":8443"`, not `:443` —
`Alt-Svc` names the port the *client* dials, and staging is published on `:8443`.

Verify (system `curl` on the host has no HTTP/3 support; use an image that does):

```bash
curl -sSI --http2 https://<host>/ | grep -i alt-svc
docker run --rm ymuski/curl-http3 curl -sSI --http3-only https://<host>/   # expect: HTTP/3 200
```

## Backups

`docker/backup.sh` (cron, daily) — `pg_dump | gzip` → MinIO bucket `backups`, 30-day retention. Runbook in archived DEPLOY §6.
