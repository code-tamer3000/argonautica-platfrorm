# Files & Media (MinIO)

> Source: docs/archive/{DATA_MODEL.md, DECISIONS.md (media + fast delivery), PLATFORM_SPEC.md §3.4/§6.4, OPERATIONS.md §4}, restructured 2026-07-06.
> Endpoints: `/api/media`. Table: `media_assets` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/media.py`.

## Principle

Bytes live in **MinIO** (S3-compatible), private buckets. Metadata in `media_assets`. Client uploads/downloads go **directly to MinIO** via presigned URLs, bypassing FastAPI. The only server-side byte read is image-thumbnail generation on confirm. `kind`: `image` / `video` / `file` / `audio` (voice).

## Upload flow (presigned-PUT)

0. **Client media compression (chat, before step 1).** Both compress in `preparePendingUpload` (`frontend/src/lib/mediaUpload.ts`), same contract: feature-detected, best-effort, **the original is uploaded unchanged on any failure/timeout or unsupported platform** — compression is an optimization, never a gate, media is never lost to it. Dimensions (and the video poster) are taken from the *compressed* blob. Non-chat paths (`mediaUpload()` for avatars/stickers/KB) are untouched.
   - **Video** was the slowest single step (prod: 60 MB → 153 s, bottleneck is the mobile **uplink** ~3–6 Mbps, not the server). `videoTranscode.ts` re-encodes **video larger than ~8 MB** to **≤720p at a capped ~2.5 Mbps** via `<video>`→`<canvas>`→`canvas.captureStream()`→`MediaRecorder` (no ffmpeg.wasm — nothing added to the bundle). The **original audio track is muxed back in** (`video.captureStream().getAudioTracks()`). Falls back to the original on platforms without `MediaRecorder` / a supported container / `captureStream` (older iOS WebViews). Transcoding runs at playback speed, so `transcodeVideo` reports **progress** (`currentTime/duration`, clamped 0..0.99, then 1 on `onended`) up through `preparePendingUpload`/`mediaUpload` — the chat composer shows «Сжатие NN%» on the paperclip and `MediaComposer` (tasks/journal) shows a «Сжатие NN%» bar, instead of an indefinite spinner on a big clip.
   - **Photo** hits prod two ways: phone photos (2–4 MB) clog the same uplink, *and* the un-shrunk original is later downloaded whole on lightbox-click (prod GET: png/jpg avg 1.5–4 s, tail to ~100 s, vs. webp thumbnails at ~0.1 s). `imageCompress.ts` re-encodes **images larger than ~1 MB** to **≤2048px WebP (q≈0.82, JPEG fallback)** via `createImageBitmap`/`<img>`→`<canvas>`→`toBlob` — so shrinking once on the client fixes **both** the upload and the later original-fetch of that object. `svg`/`gif` are skipped (vector / possibly animated); a "compressed" blob that isn't smaller than the source is discarded (original wins). EXIF orientation is applied by the browser during decode (`imageOrientation:'from-image'` / default `image-orientation`).
   - Effect is measured the same way for each: a `client:upload:<video:transcode|image:compress>` step (how long compression takes on real devices; ms-histogram — the client sends **only** durations here, since `api/metrics.py` buckets every step as ms), and the `size` on `client:upload:<kind>:put`, which now carries the *compressed* byte count (`MediaTracer` size = `blob.size`) — so a drop there vs. the pre-change baseline is the before/after signal. In dev the exact before→after MB and `%` are logged to the console.
1. `POST /api/media/uploads` — validate type & size (§6.4) → return a presigned-PUT. Upload intent stored in Redis (TTL **1h**, `PRESIGN_EXPIRES`). The URL signature and the Redis intent share this TTL: on a slow mobile uplink (~3–6 Mbps) a large video used to outrun the old 15m signature *mid-PUT* — MinIO then 400/403'd and the file was lost (prod: PUT at 164s/614s/2351s → 400). 1h covers realistic large uploads, stays within the SigV4 7-day ceiling, and still expires stale intents. If a PUT *still* outlives it, the client shows a plain "upload took too long" message instead of a raw status code. Size limit `MEDIA_MAX_UPLOAD_BYTES`.
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
- Feeds load the thumbnail; the original loads on click (lightbox). Images render as a native `<img loading="lazy">` (no blob-progress fetch, no spinner); the box reserves `aspect-ratio` from `width`/`height` up front so there's no layout shift — only the box background shows until the image decodes. Legacy rows without dimensions get no reserved box (see backfill below). **In the lightbox**, the original image is fetched with a **download progress bar**: `useImageDownload` streams it via `fetch` + `ReadableStream` (received / `Content-Length`) and shows a % overlay while it loads, then swaps in the finished blob — a native `<img src>` gives no progress, so on a slow link the user sees the bar instead of a blank frame. Best-effort: no stream / no `Content-Length` / fetch failure → falls back to the direct `src`. Lightbox **video** stays native (`<video>` streams with range requests; the browser draws its own buffering, so a download % would be wrong).
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
