# API Conventions

> Source: derived from backend/app/api + docs/archive/{PLATFORM_SPEC.md §6, DECISIONS.md}, restructured 2026-07-06.
> Cross-cutting patterns for REST + WebSocket. Per-domain endpoints live in the feature docs.

## Shape

- REST under **`/api`**; realtime under **`/ws`** (see [MESSAGES.md](MESSAGES.md)). Health: `GET /api/health` → `{"status":"ok"}`.
- Router prefixes (one per domain): `/api/auth`, `/api/admin`, `/api/users`, `/api/rooms` (rooms + messages), `/api/media`, `/api/kb`, `/api/calendar`, `/api/stickerpacks`, `/api/dynamics`, `/api/notifications`, `/api/feedback`, `/api/faq`, `/api/cabin`, `/api/tasks`.
- Pydantic schemas for every request/response. Async endpoints throughout (async SQLAlchemy).

## Auth on the wire

- `Authorization: Bearer <access-token>` (see [AUTH.md](AUTH.md)). WS authenticates at handshake via `?token=`.
- **Authorization on every request** — membership/role checked server-side; never trust client-supplied ids (IDOR). Dependencies: `get_current_user → get_current_active_user → require_admin`, plus `require_cabin_access` for Cabin.

## Errors

- FastAPI default: non-2xx return `{"detail": "<message>"}` with the HTTP status (`raise HTTPException(status, detail)`).
- Common codes: `400` invalid input (e.g. empty message), `401` unauthenticated, `403` forbidden (wrong role/flag), `404` not found **or hidden-for-non-owner** (existence not revealed, e.g. KB draft, foreign asset), `429` rate limited.
- WS errors are events, not HTTP: `{"type":"error","detail":...}`.

## Pagination

- Cursor by monotonic id, not offset. Message feed: `before` / `after` (id), `limit` (`ge=1, le=100`, default 50). See [MESSAGES.md](MESSAGES.md).

## Mutation patterns

- **Whitelist PATCH** — updates accept only explicitly whitelisted fields; unknown fields rejected (`extra="forbid"` on schemas). Pattern shared by `admin.update_user`, `kb.update_item`, `PATCH /me`.
- **Idempotency** — pin/unpin, member add/remove, media attach/detach, task-media attach are idempotent.
- **Server-derived identity** — author/owner taken from the token, never the body (feedback, cabin, submissions, …).

## Rate limiting

- `services/ratelimit.py`: fixed-window counters in Redis → `429` + `Retry-After`. `client_ip` = first `X-Forwarded-For` (behind nginx).
- Applied to: `login` (by IP), `send_message` and `request_upload` (by user). Limits are env-tunable (`rate_limit_*` in config); global switch `RATE_LIMIT_ENABLED` (off in tests).

## Observability

- **Every HTTP request is measured** by `ObservabilityMiddleware` (`core/observability.py`), registered as the outermost middleware so the timing covers dependencies and response serialization. WebSocket is deliberately not instrumented (long-lived connection — "response time" is meaningless there).
- **`X-Request-ID`** — returned on every response; an incoming header of the same name is reused (trimmed to 64 chars) so an edge-generated id survives. Stored in contextvars (`core/context.py`), so every log line of one request carries the same id.
- **One structured JSON line per request** to stdout via the `app.metrics` logger: `event`, `request_id`, `user_id`, `method`, `route`, `scenario`, `status`, `server_ms`, `bytes`, `error`. Unhandled exceptions log `event: "http_error"` with the exception type and message, then re-raise (FastAPI builds the 500).
- **Field whitelist** — `log_structured()` in `core/metrics.py` is the only entry point for request/error logs and drops anything outside `_ALLOWED_LOG_FIELDS`. Request and response bodies have no path into the logs: privacy is enforced by mechanism, not by author discipline. Regression test: `tests/test_http_metrics.py::test_message_text_never_reaches_logs`.
- **Aggregates in Redis** reuse the media bucket-histogram machinery (24h sliding window, no time axis — that comes with the metrics store): `metrics:http:dur:<METHOD>:<route>`, `metrics:http:status:<METHOD>:<route>` (2xx/4xx/5xx counters), `metrics:http:scenario:<name>`.
- **Route template, never the concrete path** — `/api/rooms/{room_id}/messages`, so key cardinality does not grow with the number of rooms. Requests matching no route collapse into `<unmatched>`.
- **Named scenarios** (`_SCENARIOS` in `core/metrics.py`): `login`, `room_open`, `kb_feed`, `dynamics_journal` — percentiles tracked separately from the general mass.
- `GET /api/metrics/http` (admin) → `{enabled, routes: {...}, scenarios: {...}}` with count, avg, p50/p90/p99, status classes and `error_rate`. Switch: `HTTP_METRICS_ENABLED`; TTL: `HTTP_METRICS_TTL_SECONDS`.

## Testing

Integration tests hit the app with httpx against a real test DB (Postgres/Redis via compose); do not mock them. New endpoint → integration test; bug fix → regression test. See CLAUDE.md testing rules and [DEPLOY.md](DEPLOY.md) for `make` targets.
