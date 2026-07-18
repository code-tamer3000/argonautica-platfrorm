# Files & Media (MinIO)

> Source: docs/archive/{DATA_MODEL.md, DECISIONS.md (media + fast delivery), PLATFORM_SPEC.md §3.4/§6.4, OPERATIONS.md §4}, restructured 2026-07-06.
> Endpoints: `/api/media`. Table: `media_assets` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/media.py`.

## Principle

Bytes live in **MinIO** (S3-compatible), private buckets. Metadata in `media_assets`. Client uploads/downloads go **directly to MinIO** via presigned URLs, bypassing FastAPI. The only server-side byte reads are image-thumbnail generation on confirm and **video transcoding in the background worker** (see "Video transcode"). `kind`: `image` / `video` / `file` / `audio` (voice).

## Upload flow (presigned-PUT)

0. **Client image compression (before step 1).** Photos are shrunk in `preparePendingUpload` (`frontend/src/lib/mediaUpload.ts`): feature-detected, best-effort, **the original is uploaded unchanged on any failure/timeout or unsupported platform** — compression is an optimization, never a gate. Dimensions are taken from the *compressed* blob. **Video is NOT compressed on the client** — the original is uploaded as-is and transcoded server-side (see "Video transcode"). The client still captures a video poster locally for an instant preview while the variant is processing.
   - **Photo** hits prod two ways: phone photos (2–4 MB) clog the mobile uplink, *and* the un-shrunk original is later downloaded whole on lightbox-click (prod GET: png/jpg avg 1.5–4 s, tail to ~100 s, vs. webp thumbnails at ~0.1 s). `imageCompress.ts` re-encodes **images larger than ~1 MB** to **≤2048px WebP (q≈0.82, JPEG fallback)** via `createImageBitmap`/`<img>`→`<canvas>`→`toBlob` — so shrinking once on the client fixes **both** the upload and the later original-fetch of that object. `svg`/`gif` are skipped (vector / possibly animated); a "compressed" blob that isn't smaller than the source is discarded (original wins). EXIF orientation is applied by the browser during decode (`imageOrientation:'from-image'` / default `image-orientation`).
   - Effect is measured by a `client:upload:image:compress` step (how long compression takes on real devices; ms-histogram — the client sends **only** durations, since `api/metrics.py` buckets every step as ms), and the `size` on `client:upload:image:put`, which carries the *compressed* byte count (`MediaTracer` size = `blob.size`). In dev the exact before→after MB and `%` are logged to the console.
1. `POST /api/media/uploads` — validate type & size (§6.4) → return a presigned-PUT. Upload intent stored in Redis (TTL **1h**, `PRESIGN_EXPIRES`). The URL signature and the Redis intent share this TTL: on a slow mobile uplink (~3–6 Mbps) a large video used to outrun the old 15m signature *mid-PUT* — MinIO then 400/403'd and the file was lost (prod: PUT at 164s/614s/2351s → 400). 1h covers realistic large uploads, stays within the SigV4 7-day ceiling, and still expires stale intents. If a PUT *still* outlives it, the client shows a plain "upload took too long" message instead of a raw status code. Size limit `MEDIA_MAX_UPLOAD_BYTES`.
2. Client PUTs the file straight to MinIO (video never streams through the app).
3. `POST /api/media/assets` — confirm: size taken from MinIO (`head_object`), not the client; row created in `media_assets`. Buckets ensured in lifespan (`ensure_buckets`).

## Read flow (presigned-GET)

- `GET /api/media/{id}` — after `assert_media_access`, return a presigned-GET (TTL 24h for caching; SigV4 allows up to 7 days). Video supports HTTP range (seek).
- **Access (`assert_media_access`)** grants when the caller: owns the asset; is a member of a room whose message links it; the asset is attached to a **published** KB item; or the asset belongs to a task visible to the caller (common → all; individual → assignee/admin). Avatars and stickers are visible to any participant (no per-asset check). See [KB.md](KB.md), [TASKS.md](TASKS.md).

## Thumbnails (best-effort; failure never blocks upload)

- **Images** — on confirm the server pulls the original once from MinIO, shrinks it (Pillow, WebP, ≤1024px), stores it as `thumb_key`. This is the single place bytes cross the backend, once per upload, not per view.
- **Video** — two posters, both best-effort. **Client**: captures a poster frame (`<video>`→canvas→WebP), uploads it as a separate object, passes its key in confirm as `thumb_storage_key`; the server verifies a live upload intent for that key (same user, kind image) before adopting it as `thumb_key` — this gives an **instant** preview while the variant is still processing. **Server**: the transcode worker also extracts a poster (`~1s` frame, WebP) and sets it as `thumb_key` (fallback for clients that couldn't capture one, e.g. iOS, and for consistency with the variant). The poster doubles as `<video poster>`.
- `thumb_key = NULL` → no preview; the original loads instead.

## Lightbox preview (mid-size derivative)

Thumbnails (≤1024px, q80) are for the feed; the lightbox used to open the **original** — prod measurements showed ~90% of media traffic was full-size originals (a real case: an 11 MB JPG fetched whole for one look). So images get a second derivative: `preview_key`, a WebP at **≤1600px, q82** under a `previews/` prefix (`services/media.py::build_preview_key`), generated on confirm right next to the thumbnail (`generate_image_preview`, same best-effort contract — any failure → `NULL` + a log line, never blocks the upload).

- **Only `kind='image'`.** Video/files and pre-feature rows keep `preview_key = NULL` (no backfill).
- **Never heavier than the source.** A small image isn't resized and its WebP can come out *larger* than the original; in that case no object is stored and `preview_key` stays `NULL` — the original wins (same rule as client-side compression above).
- **Payload.** `AttachmentOut.preview_url` is a presigned-GET of `preview_key`, or `null`. `url` is unchanged (original / video variant) and stays the download source. Client rule: display `preview_url ?? url`, download `url`.

## Video transcode (server-side)

Every uploaded video is transcoded in the background to a streaming-friendly H.264 720p variant; clients receive the variant, not the raw upload. This replaced client-side compression (in-browser `MediaRecorder` encoding drained battery, could crash low-end devices, and made the user wait *before* upload even started). Service: `services/transcode.py`; queue: `services/transcode_queue.py`; worker: `app/worker/transcode.py`.

**Flow.** On confirm, a video row is created with `transcode_status='processing'` and enqueued (Redis list, `after_commit` so the worker never sees a not-yet-committed row). The message is sent immediately; recipients see the attachment in a **processing** state (client poster + spinner). The worker (a separate process, one job at a time — ffmpeg saturates cores) pulls the job → downloads the original from MinIO → `ffprobe` → transcodes (or fast-path) → uploads the variant + poster → updates the row (`variant_key`, `variant_mime`, `thumb_key`, `transcode_status='done'`) → publishes `attachment.updated` to the chat room(s) holding the video (see [MESSAGES.md](MESSAGES.md)). The client swaps processing → playable in place.

**ffmpeg spec.** `libx264 -preset veryfast -crf 23`, AAC 128k, `-movflags +faststart` (moov atom up front → playback starts before full download), `-vf scale=-2:min(720,ih)` (never upscale, even width for libx264). **Fast-path:** if `ffprobe` shows the source is already H.264 + AAC + faststart + height ≤ 720, transcoding is skipped and `variant_key = storage_key` (the original is served as-is); a poster is still generated. **Guardrails:** source size ≤ `TRANSCODE_MAX_SOURCE_BYTES` (4 GB), duration ≤ `TRANSCODE_MAX_DURATION_SECONDS` (3 h), and each ffmpeg run has a hard timeout (`TRANSCODE_FFMPEG_TIMEOUT_SECONDS`, 90 min). A **timeout** counts as a failed attempt and is retried; a **size/duration breach** is terminal on the first attempt (see Retries below).

These four settings are coupled — changing the duration cap alone just moves the failure:
a longer video must still finish inside the ffmpeg timeout, and the claim timeout must
outlast the ffmpeg run. Sizing on the prod box (4 vCPU): `libx264 veryfast` at 720p measured
≈ 11.7× realtime on synthetic input; budgeting ~3× for real footage, 3 h of video ≈ 60 min of
work, so the 90-min timeout carries a 2× margin and the claim timeout sits above it at 2 h.

The client checks duration and size **before uploading** (`preparePendingUpload`, limits
mirrored in `frontend/src/lib/mediaUpload.ts`) — the server stays the source of truth and
re-checks, but a doomed file no longer costs a full upload first.

**Storage layout.** Originals keep their existing key (`YYYY/MM/<uuid>.<ext>`, untouched). Variants live under a parallel prefix `video/720/<uuid>.mp4`. Posters use the existing `thumbnails/` scheme.

**Retries & durability.** On failure the job is requeued with backoff up to `TRANSCODE_MAX_ATTEMPTS` (3 = 1 + 2 retries). **Exception: guardrail rejections (`TranscodeRejected` — over size/duration) are terminal immediately**, because a retry would hit the same limit while re-downloading the original each time (on a 700 MB source that is 2 GB of pointless traffic). Terminal failure sets `transcode_status='failed'` and publishes `attachment.updated` with the failed status — the **original stays downloadable** (served as a file with a "processing failed" hint). Job state (pending/inflight/attempts) is ephemeral (Redis only); the durable serving state is `media_assets.transcode_status`. Worker-crash safety: a claimed-but-unacked job left in `transcode:inflight` past `TRANSCODE_CLAIM_TIMEOUT_SECONDS` (2 h) is reclaimed into `pending` by any worker (`reclaim_stale`), so a mid-job crash never loses the job silently. That timeout **must stay well above** the ffmpeg timeout: set it lower and a still-running job gets reclaimed out from under a live worker, duplicating the work.

**Serving & stale clients.** The attachment/API payload's `url` is the variant iff `transcode_status='done'` and `variant_key` is set, else the original (`services/media.py::serving_key`). A client that predates the feature (blue-green window) — or that doesn't know the `processing` state — still gets a playable URL for old-format rows and renders the message. **Rollout:** legacy videos uploaded before this feature keep `transcode_status=NULL` and are served unchanged; historical media is **not** backfilled (possible follow-up).

**Scope.** All uploaded video is transcoded (chat, tasks/journal, KB). The live `attachment.updated` swap fires only for chat (only messages have a room channel); task/KB videos pick up the variant on their next fetch.

**Runtime dep.** ffmpeg/ffprobe are backend runtime deps (already in `backend/Dockerfile`, so present in the dev/test image). Dev: run the worker as a compose service (`transcode-worker` in `docker/docker-compose.yml`) or on the host (`python -m app.worker.transcode`). Prod: the user adds the worker service manually — see [DEPLOY.md](DEPLOY.md).

## Fast delivery in feeds

- Presigned URLs are embedded **in the message payload** (`MessageOut.attachments`: url + thumb_url + metadata, batch-signed via `resolve_attachments`), not fetched per asset — kills N round-trips on mobile. Access is gated by the room (whoever reads the message reads its attachments). `attachment_ids` kept for backward compatibility.
- Feeds load the thumbnail; the original loads on click (lightbox). Images render as a native `<img loading="lazy">` (no blob-progress fetch, no spinner); the box reserves `aspect-ratio` from `width`/`height` up front so there's no layout shift — only the box background shows until the image decodes. Legacy rows without dimensions get no reserved box (see backfill below). **In the lightbox**, the original image is fetched with a **download progress bar**: `useImageDownload` streams it via `fetch` + `ReadableStream` (received / `Content-Length`) and shows a % overlay while it loads, then swaps in the finished blob — a native `<img src>` gives no progress, so on a slow link the user sees the bar instead of a blank frame. Best-effort: no stream / no `Content-Length` / fetch failure → falls back to the direct `src`. Lightbox **video** stays native (`<video>` streams with range requests, so seeking and start-before-fully-loaded keep working — a download % of the *whole file* would be wrong for a stream), but shows a **buffering indicator** over the frame while it isn't yet playable (`LightboxVideo` in `Overlay.tsx`): a spinner until `duration` is known, then a «буфер NN%» bar from `video.buffered / duration` around the current position. It hides once the video is playable (`readyState ≥ HAVE_FUTURE_DATA` / `canplay` / `playing`) and reappears on `waiting`/`seeking`.
- Caching: presigned-GET TTL 24h + nginx `Cache-Control: private, max-age=86400, immutable` on media; objects are immutable (key = uuid). Text responses gzipped; media not (already compressed).

## Сбор метрик (измерительный слой)

Инструмент, чтобы найти, **где** теряется время при отправке/загрузке медиа с телефона,
до того как чинить. Включается флагом `MEDIA_METRICS_ENABLED` (по умолчанию `true`;
агрегаты живут `MEDIA_METRICS_TTL_SECONDS`, дефолт сутки). Три источника таймингов:

- **Клиент** (`frontend/src/lib/metrics.ts`) — реальные шаги с устройства пользователя:
  upload = `presign → put (в MinIO) → poster → confirm`; download = время загрузки
  превью картинки (`load`) и presign-GET round-trip БЗ (`presign`). Тип сети берётся из
  `navigator.connection.effectiveType`. Трейсы копятся и уходят пачкой на
  `POST /api/metrics/media` (`keepalive`, дослать на `pagehide`) — сбор best-effort,
  на саму отправку/загрузку не влияет.
- **Бэкенд** (`app/api/media.py::confirm_upload`) — разбивка confirm: `stat` (head_object)
  и `thumbnail` (генерация превью картинки) отдельными шагами (`source=server`).
- **nginx** (`log_format media_perf`) — время отдачи MinIO: `req_time`, `upstream_time`,
  `bytes` в `/var/log/nginx/media_perf.log` на media-локациях.

Приём метрик открыт любому активному юзеру (шлёт только со своих операций); свод
`GET /api/metrics/media` — только админу: `{enabled, steps:{"<source>:<op>:<kind>:<step>":
{count, avg_ms, p50, p90, p99}}}`. Перцентили — метки бакетов гистограммы в Redis
(`metrics:media:*`), грубые, но достаточные, чтобы увидеть хвост. Значения клиентские —
только наблюдение, ни на какие решения сервера не влияют.

**Runbook (на реальном сервере):**
1. Задеплоить бэкенд+фронт обычным blue-green; при желании применить nginx-шаблон
   (`nginx -s reload`) — иначе просто не будет `media_perf.log`, остальное работает.
2. Попользоваться с телефона 10–15 мин (отправить/открыть фото и видео).
3. Сырые события: `docker logs <backend> 2>&1 | grep '"metric"' | tail -50`
   (клиентские трейсы + серверная разбивка confirm).
4. Свод перцентилей: открыть `GET /api/metrics/media` под админом (или `curl` с токеном).
5. nginx-отдача: `docker logs <nginx> 2>&1 | grep media_perf | tail -50` (или файл лога).

Формат строк лога (JSON с полем `"metric": "media"`, и `media_perf ...` у nginx)
стабилен — на него завязан этот грепанье (grep по `"metric"` ловит все события; сам
JSON печатается с пробелами после двоеточий). По собранным цифрам — отдельная задача с фиксами (напр. асинхронная
генерация превью после ответа, `proxy_buffering off` на GET-медиа, tune presign).

## Backfill (one-off)

Older images uploaded before thumbnails have `thumb_key = NULL`. `backend/scripts/backfill_thumbnails.py` regenerates them (idempotent, batched, images only; videos are client-posters). Runbook in the archived OPERATIONS §4.

Older images uploaded before the client sent dimensions have `width`/`height = NULL` — the feed can't reserve an `aspect-ratio` box for them, causing layout shift. `backend/scripts/backfill_image_dims.py` pulls the **original** (not thumb) from MinIO and reads its size via Pillow (idempotent — only touches `kind='image'` rows with `width IS NULL OR height IS NULL`; batched; best-effort, broken/missing objects are skipped and logged). Same runbook pattern as `backfill_thumbnails.py`.
