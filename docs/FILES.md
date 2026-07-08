# Files & Media (MinIO)

> Source: docs/archive/{DATA_MODEL.md, DECISIONS.md (media + fast delivery), PLATFORM_SPEC.md §3.4/§6.4, OPERATIONS.md §4}, restructured 2026-07-06.
> Endpoints: `/api/media`. Table: `media_assets` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/media.py`.

## Principle

Bytes live in **MinIO** (S3-compatible), private buckets. Metadata in `media_assets`. Client uploads/downloads go **directly to MinIO** via presigned URLs, bypassing FastAPI. The only server-side byte read is image-thumbnail generation on confirm. `kind`: `image` / `video` / `file` / `audio` (voice).

## Upload flow (presigned-PUT)

1. `POST /api/media/uploads` — validate type & size (§6.4) → return a presigned-PUT. Upload intent stored in Redis (TTL ~15m). Size limit `MEDIA_MAX_UPLOAD_BYTES` (100 MB).
2. Client PUTs the file straight to MinIO (video never streams through the app).
3. `POST /api/media/assets` — confirm: size taken from MinIO (`head_object`), not the client; row created in `media_assets`. Buckets ensured in lifespan (`ensure_buckets`).

## Read flow (presigned-GET)

- `GET /api/media/{id}` — after `assert_media_access`, return a presigned-GET (TTL 24h for caching; SigV4 allows up to 7 days). Video supports HTTP range (seek).
- **Access (`assert_media_access`)** grants when the caller: owns the asset; is a member of a room whose message links it; the asset is attached to a **published** KB item; or the asset belongs to a task visible to the caller (common → all; individual → assignee/admin). Avatars and stickers are visible to any participant (no per-asset check). See [KB.md](KB.md), [TASKS.md](TASKS.md).

## Thumbnails (best-effort; failure never blocks upload)

- **Images** — on confirm the server pulls the original once from MinIO, shrinks it (Pillow, WebP, ≤1024px), stores it as `thumb_key`. This is the single place bytes cross the backend, once per upload, not per view.
- **Video** — the **client** captures a poster frame (`<video>`→canvas→WebP) and uploads it as a separate object, passing its key in confirm as `thumb_storage_key`. The server verifies a live upload intent for that key (same user, kind image) before adopting it as `thumb_key`; mismatch → video simply has no poster. The poster doubles as `<video poster>`.
- `thumb_key = NULL` → no preview; the original loads instead.

## Fast delivery in feeds

- Presigned URLs are embedded **in the message payload** (`MessageOut.attachments`: url + thumb_url + metadata, batch-signed via `resolve_attachments`), not fetched per asset — kills N round-trips on mobile. Access is gated by the room (whoever reads the message reads its attachments). `attachment_ids` kept for backward compatibility.
- Feeds load the thumbnail; the original loads on click (lightbox).
- Caching: presigned-GET TTL 24h + nginx `Cache-Control: private, max-age=86400, immutable` on media; objects are immutable (key = uuid). Text responses gzipped; media not (already compressed).

## Backfill (one-off)

Older images uploaded before thumbnails have `thumb_key = NULL`. `backend/scripts/backfill_thumbnails.py` regenerates them (idempotent, batched, images only; videos are client-posters). Runbook in the archived OPERATIONS §4.

Older images uploaded before the client sent dimensions have `width`/`height = NULL` — the feed can't reserve an `aspect-ratio` box for them, causing layout shift. `backend/scripts/backfill_image_dims.py` pulls the **original** (not thumb) from MinIO and reads its size via Pillow (idempotent — only touches `kind='image'` rows with `width IS NULL OR height IS NULL`; batched; best-effort, broken/missing objects are skipped and logged). Same runbook pattern as `backfill_thumbnails.py`.
