# Files & Media (MinIO)

> Source: docs/archive/{DATA_MODEL.md, DECISIONS.md (media + fast delivery), PLATFORM_SPEC.md §3.4/§6.4, OPERATIONS.md §4}, restructured 2026-07-06.
> Endpoints: `/api/media`. Table: `media_assets` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/media.py`.

## Principle

Bytes live in **MinIO** (S3-compatible), private buckets. Metadata in `media_assets`. Client uploads/downloads go **directly to MinIO** via presigned URLs, bypassing FastAPI. The only server-side byte reads are image-thumbnail generation on confirm and **video/audio transcoding in the background worker** (see "Video transcode" / "Audio transcode"). `kind`: `image` / `video` / `file` / `audio` (voice).

## Upload flow (presigned-PUT)

0. **Client image compression (before step 1).** Photos are shrunk in `preparePendingUpload` (`frontend/src/lib/mediaUpload.ts`): feature-detected, best-effort, **the original is uploaded unchanged on any failure/timeout or unsupported platform** — compression is an optimization, never a gate. Dimensions are taken from the *compressed* blob. **Video is NOT compressed on the client** — the original is uploaded as-is and transcoded server-side (see "Video transcode"). The client still captures a video poster locally for an instant preview while the variant is processing.
   - **Photo** hits prod two ways: phone photos (2–4 MB) clog the mobile uplink, *and* the un-shrunk original is later downloaded whole on lightbox-click (prod GET: png/jpg avg 1.5–4 s, tail to ~100 s, vs. webp thumbnails at ~0.1 s). `imageCompress.ts` re-encodes **images larger than ~1 MB** to **≤2048px WebP (q≈0.82, JPEG fallback)** via `createImageBitmap`/`<img>`→`<canvas>`→`toBlob` — so shrinking once on the client fixes **both** the upload and the later original-fetch of that object. `svg`/`gif` are skipped (vector / possibly animated); a "compressed" blob that isn't smaller than the source is discarded (original wins). EXIF orientation is applied by the browser during decode (`imageOrientation:'from-image'` / default `image-orientation`).
   - Effect is measured by a `client:upload:image:compress` step (how long compression takes on real devices; ms-histogram — the client sends **only** durations, since `api/metrics.py` buckets every step as ms), and the `size` on `client:upload:image:put`, which carries the *compressed* byte count (`MediaTracer` size = `blob.size`). In dev the exact before→after MB and `%` are logged to the console.
1. `POST /api/media/uploads` — validate type & size (§6.4) → return a presigned-PUT. Upload intent stored in Redis (TTL **1h**, `PRESIGN_EXPIRES`). The URL signature and the Redis intent share this TTL: on a slow mobile uplink (~3–6 Mbps) a large video used to outrun the old 15m signature *mid-PUT* — MinIO then 400/403'd and the file was lost (prod: PUT at 164s/614s/2351s → 400). 1h covers realistic large uploads, stays within the SigV4 7-day ceiling, and still expires stale intents. If a PUT *still* outlives it, the client shows a plain "upload took too long" message instead of a raw status code. Size limit `MEDIA_MAX_UPLOAD_BYTES`.
2. Client PUTs the file straight to MinIO (video never streams through the app).
3. `POST /api/media/assets` — confirm: size taken from MinIO (`head_object`), not the client; row created in `media_assets`. Buckets ensured in lifespan (`ensure_buckets`).

## Read flow (presigned-GET)

- `GET /api/media/{id}` — after `assert_media_access`, return a presigned-GET (TTL 24h from issue, `PRESIGN_GET_EXPIRES`; SigV4 allows up to 7 days). Video supports HTTP range (seek).
- **Access (`assert_media_access`)** grants when the caller: owns the asset; is a member of a room whose message links it; the asset is attached to a **published** KB item; or the asset belongs to a task visible to the caller (common → all; individual → assignee/admin). Avatars, stickers and diary covers (`rooms.avatar_media_id`) are visible to any participant (no per-asset check — the room's own access check already gates them). See [KB.md](KB.md), [TASKS.md](TASKS.md), [ROOMS.md](ROOMS.md).
- **Stable URL, ordinary browser cache (ARG-75).** `presigned_get_url` (`services/media.py`) rounds the signing moment down to `PRESIGN_GET_WINDOW` (24h, floor to UTC day) before calling boto3 — two calls for the same object within the window produce a byte-identical URL. That fixes the actual cache miss: nginx already serves `Cache-Control: private, max-age=86400, immutable`, but the browser's HTTP cache keys on the full URL *including query*, and `X-Amz-Date`/`X-Amz-Signature` used to change on every feed render, so the cache never hit — structurally, regardless of headers. boto3 has no public hook for the signing moment (`X-Amz-Date` comes from `botocore.auth.get_current_datetime()` inside `SigV4Auth.add_auth`), so the module temporarily patches that function under a lock for the duration of one `generate_presigned_url` call (`_frozen_signing_clock`). Because SigV4's `ExpiresIn` is counted from the (rounded) signing moment, `ExpiresIn = PRESIGN_GET_EXPIRES + PRESIGN_GET_WINDOW` (48h) — a client that receives the link in the last second of the window still gets a full 24h before it expires; this is the traded-off cost, an expired-or-revoked link can now be live for up to 48h instead of 24h. `download_name` (`ResponseContentDisposition`) is part of the signature too — it MUST be identical across calls for the same object, or the object gets two different cache entries; the single source of truth is `attachment_download_name()`, used by both `build_attachment_out` and `GET /api/media/{id}`.

## Thumbnails (best-effort; failure never blocks upload)

- **Images** — on confirm the server pulls the original once from MinIO, shrinks it (Pillow, WebP, ≤1024px), stores it as `thumb_key`. This is the single place bytes cross the backend, once per upload, not per view.
- **Video** — two posters, both best-effort. **Client**: captures a poster frame (`<video>`→canvas→WebP), uploads it as a separate object, passes its key in confirm as `thumb_storage_key`; the server verifies a live upload intent for that key (same user, kind image) before adopting it as `thumb_key` — this gives an **instant** preview while the variant is still processing. **Server**: the transcode worker also extracts a poster (`~1s` frame, WebP) and sets it as `thumb_key` (fallback for clients that couldn't capture one, e.g. iOS, and for consistency with the variant). The poster doubles as `<video poster>`.
- `thumb_key = NULL` → no preview; the original loads instead.
- **HEIC/HEIF originals (ARG-143).** Some iOS share paths hand the browser a `File` whose `.type` says `image/jpeg` while the actual bytes are HEIC — Pillow decodes by content, not by the declared `Content-Type`, so before this fix `generate_image_thumbnail`/`generate_image_preview` raised `PIL.UnidentifiedImageError` and `thumb_key`/`preview_key` stayed `NULL`. Worse than the usual best-effort gap: the `NULL`-fallback is "load the original", and a raw HEIC file doesn't render in `<img>` on any browser except Safari/iOS — the photo was invisible, not just thumbnail-less. Fix: `pillow_heif.register_heif_opener()` is registered once at module import in `services/media.py`, so `PIL.Image.open` transparently decodes HEIC/HEIF the same way it already does JPEG/PNG/WebP — `generate_image_thumbnail`/`generate_image_preview` need no format-specific branch. Additionally, `generate_image_variant` (confirm-time, synchronous) checks `Image.open(...).format`; if it's really HEIF, it converts to JPEG and stores it as `variant_key`/`variant_mime` — the same columns `video`/`audio` use for their transcoded variant (ADR-024) — and `serving_key` prefers it for `kind='image'` whenever `variant_key` is set, so `url` (download/lightbox-fallback) also stops being raw HEIC. A regular JPEG/PNG/WebP upload is unaffected: `generate_image_variant` returns `(None, None)`, no-op. Historical rows: `backend/scripts/backfill_heic_variant.py` (idempotent, `variant_key IS NULL`, best-effort) — independent of `backfill_thumbnails.py`/`backfill_media_derivatives.py --images`, which now also succeed on HEIC rows for the same reason (registered opener) and need no changes of their own.

## Avatars, room/diary covers, stickers (`presign_asset_urls`)

`presign_asset_urls` (`services/media.py`) is the batch presign used everywhere an
asset is shown as a small tile rather than opened full-size: user avatars, room and
diary covers (`rooms.avatar_media_id`), stickers. It presigns `thumb_key` (≤1024px
WebP) instead of `storage_key` when a thumbnail exists, falling back to the original
when `thumb_key IS NULL`. Before this, all nine call sites (`api/users.py`,
`api/rooms.py`, `api/argonauts.py`, `api/auth.py`, `api/stickers.py`) served the full
original — avatars up to a few MB, refetched on every device on every room-list open —
even though the thumbnail had already been generated on upload. No payload/schema
change: the field is still a presigned-GET URL, only the object it points at changes.

## Lightbox preview (mid-size derivative)

Thumbnails (≤1024px, q80) are for the feed; the lightbox used to open the **original** — prod measurements showed ~90% of media traffic was full-size originals (a real case: an 11 MB JPG fetched whole for one look). So images get a second derivative: `preview_key`, a WebP at **≤1600px, q82** under a `previews/` prefix (`services/media.py::build_preview_key`), generated on confirm right next to the thumbnail (`generate_image_preview`, same best-effort contract — any failure → `NULL` + a log line, never blocks the upload).

- **Only `kind='image'`.** Video/files keep `preview_key = NULL`. Pre-feature rows start NULL too and are caught up offline by `backfill_media_derivatives.py` (see Backfill below).
- **Never heavier than the source.** A small image isn't resized and its WebP can come out *larger* than the original; in that case no object is stored and `preview_key` stays `NULL` — the original wins (same rule as client-side compression above).
- **Payload.** `AttachmentOut.preview_url` is a presigned-GET of `preview_key`, or `null`. `url` is unchanged (original / video variant) and stays the download source. Client rule: display `preview_url ?? url`, download `url`.

## Video transcode (server-side)

Every uploaded video is transcoded in the background to a streaming-friendly H.264 720p variant; clients receive the variant, not the raw upload. This replaced client-side compression (in-browser `MediaRecorder` encoding drained battery, could crash low-end devices, and made the user wait *before* upload even started). Service: `services/transcode.py`; queue: `services/transcode_queue.py`; worker: `app/worker/transcode.py`.

**Flow.** On confirm, a video row is created with `transcode_status='processing'` and enqueued (Redis list, `after_commit` so the worker never sees a not-yet-committed row). The message is sent immediately; recipients see the attachment in a **processing** state (client poster + spinner). The worker (a separate process, one job at a time — ffmpeg saturates cores) pulls the job → downloads the original from MinIO → `ffprobe` → transcodes (or fast-path) → uploads the variant + poster → updates the row (`variant_key`, `variant_mime`, `thumb_key`, `transcode_status='done'`) → publishes `attachment.updated` to the chat room(s) holding the video (see [MESSAGES.md](MESSAGES.md)). The client swaps processing → playable in place.

**ffmpeg spec.** `libx264 -preset veryfast -crf 23`, AAC 128k, `-movflags +faststart` (moov atom up front → playback starts before full download), `-vf scale=-2:min(720,ih)` (never upscale, even width for libx264). **Fast-path:** if `ffprobe` shows the source is already H.264 + AAC + faststart + height ≤ 720, transcoding is skipped and `variant_key = storage_key` (the original is served as-is); a poster is still generated. **Heavier-variant guard:** if the transcode runs but the result is **not smaller** than the source, the variant is discarded (never uploaded) and `variant_key = storage_key` too, with `variant_mime` set to the source's mime — same rule as image previews, which are dropped when the derivative comes out heavier. Sources already compressed harder than CRF 23 otherwise produced a *bigger* file that was still served: on prod this hit 4 videos out of 70, worst 1.4 MB → 2.6 MB. **Guardrails:** source size ≤ `TRANSCODE_MAX_SOURCE_BYTES` (4 GB), duration ≤ `TRANSCODE_MAX_DURATION_SECONDS` (3 h), and each ffmpeg run has a hard timeout (`TRANSCODE_FFMPEG_TIMEOUT_SECONDS`, 90 min). A **timeout** counts as a failed attempt and is retried; a **size/duration breach** is terminal on the first attempt (see Retries below).

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

**Serving & stale clients.** The attachment/API payload's `url` is the variant iff `transcode_status='done'` and `variant_key` is set, else the original (`services/media.py::serving_key`). A client that predates the feature (blue-green window) — or that doesn't know the `processing` state — still gets a playable URL for old-format rows and renders the message. **Rollout:** legacy videos uploaded before this feature keep `transcode_status=NULL` and are served unchanged; they are caught up offline, slowly, by `backfill_media_derivatives.py` (see Backfill below).

**Scope.** All uploaded video is transcoded (chat, tasks/journal, KB). The live `attachment.updated` swap fires only for chat (only messages have a room channel); task/KB videos pick up the variant on their next fetch.

**Runtime dep.** ffmpeg/ffprobe are backend runtime deps (already in `backend/Dockerfile`, so present in the dev/test image). Dev: run the worker as a compose service (`transcode-worker` in `docker/docker-compose.yml`) or on the host (`python -m app.worker.transcode`). Prod: the user adds the worker service manually — see [DEPLOY.md](DEPLOY.md).

## Audio transcode (server-side)

Every uploaded `kind='audio'` object (voice messages and audio KB materials) is transcoded in the background to AAC/M4A — same queue, same worker (`app/worker/transcode.py`), same `media_assets.transcode_status`/`variant_key`/`variant_mime` fields as video, dispatched by `kind`. Service: `services/transcode.py::transcode_audio_asset`.

**Why.** `useVoiceRecorder.ts` records with `MediaRecorder`, whose codec is whatever the sender's browser offers — Android/desktop Chrome writes WebM/Opus, iOS Safari writes AAC/MP4. The recorded file is served **as uploaded**, unchanged, to every recipient: a voice message recorded on Android reaches an iPhone recipient as WebM, which a meaningful share of iOS versions/webviews do not decode at all — it silently fails to play. This can't be fixed sender-side (a browser's `MediaRecorder` can't be forced into a codec it doesn't support), so the server normalizes every voice/audio file to AAC — the one format that plays on iPhone, Android and desktop without exception.

**Flow.** Identical shape to video: on confirm, an audio row is created with `transcode_status='processing'` and enqueued (`after_commit`). The message sends immediately; there is no "processing" UI state for audio (no spinner) — `serving_key` just keeps returning the original until the variant is `done`, so playback is unaffected either way. The worker downloads the original → `ffprobe` → transcodes (or fast-path) → uploads the variant → updates the row → publishes `attachment.updated`. The client swaps the URL in place via the same generic `asset_id`-keyed cache patch used for video (no audio-specific frontend code needed).

**ffmpeg spec.** `-vn -c:a aac -b:a 128k -movflags +faststart` into `.m4a`. **Fast-path:** if `ffprobe` shows the source is already AAC (typically iPhone recordings), transcoding is skipped and `variant_key = storage_key`. **No "heavier variant" guard** (unlike video): the goal here is codec compatibility, not size — an AAC re-encode of a highly-efficient Opus source can legitimately come out larger, and that's still correct to serve, because the point is that it *plays on iPhone at all*. **No size/duration guardrail** either: upload is already capped at `MEDIA_MAX_AUDIO_BYTES` (200 MB), which is cheap for audio-only ffmpeg regardless of length, unlike video.

**Storage layout.** Originals keep their key. Variants live under `audio/aac/<uuid>.m4a`.

**Retries & durability, serving & stale clients.** Same mechanics as video (see above): `TRANSCODE_MAX_ATTEMPTS` retries, terminal failure → `transcode_status='failed'` with the original left downloadable, `transcode:inflight` reclaim on worker crash. `serving_key` returns the variant iff `transcode_status='done'` and `variant_key` is set, else the original — legacy audio rows (`transcode_status=NULL`) are served unchanged until caught up by `backfill_media_derivatives.py --audio` (see Backfill below).

**Scope.** All uploaded audio is transcoded (chat voice messages, tasks/journal, KB audio materials). The live `attachment.updated` swap fires only for chat.

## Playlist (ARG-139)

A playlist is a **new attachment kind**, orthogonal to `MessageAttachment`/`TaskMedia`/`KbItemMedia`: several `kind='audio'` tracks that play back to back as one object with a global mini-player, instead of N separate voice-message bubbles. Tables: `playlists` (title, optional cover), `playlist_tracks` (ordered, own title/artist/duration snapshot — see [DATA_MODEL.md](DATA_MODEL.md)). A playlist has **no ACL of its own**: it is created as a standalone object, then a nullable `playlist_id` FK on the carrier (`messages`, `tasks`, `kb_items` — one per carrier, like `sticker_id`) attaches it, and reads are authorized through that carrier exactly like a normal attachment.

**Create flow.** Each track file goes through the ordinary upload flow first (`POST /api/media/uploads` → PUT → `POST /api/media/assets`, `kind='audio'`), same as a voice message. The client then calls `POST /api/media/playlists` with the resulting `media_asset_id`s in attachment order plus per-track `title`/`artist`/`duration` (parsed client-side from ID3v2 tags, `frontend/src/lib/id3.ts`, falling back to the filename) and an optional `cover_media_id` (a `kind='image'` asset — either the first track's embedded ID3 picture, uploaded like any image, or one the author picks; `null` renders a design-system placeholder). The endpoint validates every asset exists and is `kind='audio'` (400 otherwise) and creates `playlists` + one `playlist_tracks` row per entry, position = list index. The playlist itself is not attached to anything yet — the very next request (send message / create task / create KB item, all accepting `playlist_id`) sets the carrier's FK. Server rejects attaching a `playlist_id` the caller doesn't own (`created_by` check) the same way it rejects a stranger's `media_asset_id`.

**Read flow.** `resolve_playlists` (mirrors `resolve_attachments`) batch-resolves `{playlist_id: PlaylistOut}` with presigned URLs for the cover and every track, embedded straight into `MessageOut.playlist`/`TaskOut.playlist`/`KbItemOut.playlist` — no extra round-trip, same principle as `AttachmentOut`. `assert_media_access` gained a playlist branch: given a `media_assets` row that is a playlist track (or cover), it looks up the owning `playlists` row, then walks the same carrier chain used for a direct attachment (published KB item + intake/plan visibility, visible task, or room membership) — so `GET /api/media/{id}` on a track works for anyone who can see the carrier, not just the playlist's creator.

**Player.** One `<audio>` element for the whole app (`frontend/src/components/GlobalPlayer.tsx`, mounted once in `AppShell`), driven by a Zustand store (`stores/player.ts`) so it survives route changes — playback doesn't stop when the user navigates from chat to KB. Tapping a track in the attachment card (`PlaylistCard.tsx`) starts the global player at that track; it advances to the next track automatically on `ended`, and stops (rewound to the first track, collapsed) after the last one. Cross-fading with the rest of the app's audio — voice messages (`VoicePlayer`) and lightbox video (`VideoPlayer`) — goes through a tiny shared registry (`stores/mediaSession.ts`, `claim`/`release`): starting any one of the three pauses whatever the other two were doing, so two sounds never play at once.

**Edit after send (author or admin, ARG-139 post-review).** Gated by `assert_playlist_editor` (`playlist.created_by == current_user.id` OR `current_user.role == 'admin'`, independent of the carrier's own permissions — an admin moderates a playlist the same way they moderate anyone's message/task). `PATCH /api/media/playlists/{id}` (body: optional `title`, optional `cover_media_id`, only applies fields actually sent) renames the title and/or replaces the cover for the **whole playlist at once** — one image for all tracks, not per-track, same `cover_media_id` slot a fresh playlist gets from the first track's embedded ID3 picture. `DELETE /api/media/playlists/{id}/tracks/{track_id}` drops one track (400 if it's the last one — a playlist can't go empty; delete its carrier instead). Track order and per-track metadata otherwise stay a snapshot of attach time — no reorder, no add-track, no per-track rename API.

**Attaching one that already exists.** `GET /api/media/playlists` (optional `q` title search, `limit`) lists the playlists the caller may attach, and `PlaylistPicker` is the first screen the «Плейлист» button opens everywhere — chat composer, task form, KB-item form — with «+ Загрузить новый» inside it falling through to the upload flow. Scope is deliberately **not** "every playlist on the platform": it is the caller's own ones plus any whose tracks they can already reach, i.e. attached to a carrier they can see. Both the listing and the attach path go through `services/media.py::can_access_playlist` / `load_attachable_playlist`, which delegate to `assert_media_access` on the first track — the same single source of truth that gates reading the media itself. That replaced the old `created_by == current_user.id` check on all four attach sites (message, task create/update, KB item create/update); an unreachable playlist id still answers 404, so a stranger cannot pull audio out of a DM by guessing ids.

Route order in `api/media.py` matters here: `GET /playlists` must be declared **before** the catch-all `GET /{asset_id}`. Starlette matches routes in registration order, not by specificity, and the literal string `"playlists"` satisfies the `{asset_id}` path pattern just fine — it only fails FastAPI's `int` coercion afterwards. Declared in the wrong order, every call to the picker's listing 422'd (`asset_id: int_parsing`) instead of ever reaching `list_playlists`, and no unit-level test caught it (calling the endpoint function directly skips ASGI routing entirely) — only a real HTTP request through the app does, see `test_list_playlists_route_not_shadowed_by_asset_id_catchall`.

**Editing in place from the form.** Inside the task and KB-item forms the attached playlist is rendered by the same `PlaylistCard` the reader sees (`PlaylistComposer` prop `editable`), not by the compact chip — so the author/admin renames it, swaps the cover and drops single tracks right there, through the usual `PATCH`/`DELETE /api/media/playlists/*`. Those calls take effect immediately (they are not part of the form's save), so `PlaylistCard` takes an optional `onChange` to hand the fresh object back to the form's state. The chat composer keeps the chip: a full card in that row would push the text input off-screen.

**Re-attaching on the carrier.** `PATCH /api/tasks/{id}` and `PATCH /api/kb/items/{id}` both take `playlist_id` with the usual three-state semantics: field absent = leave the playlist alone, an id = attach or replace (same `created_by` ownership check as on create, 404 otherwise), explicit `null` = detach (the `playlists` row itself is kept, exactly like a `media_asset` that gets unlinked). The edit forms are initialized from the carrier's own `playlist` field, so it must be present everywhere a form reads from — including `TaskLibraryItemOut` (the admin «База заданий» row), which used to omit it and made an attached playlist silently vanish from the task edit form. Republishing a task (`POST /api/admin/tasks/{id}/republish`) copies `playlist_id` to the clone, the same way it copies media: track access is gated by the carrier, not by the playlist's owner, so nothing has to be re-uploaded.

**Lock-screen / notification controls.** `GlobalPlayer` sets `navigator.mediaSession.metadata` (title/artist/album/artwork) per track and registers `play`/`pause`/`previoustrack`/`nexttrack`/`seekto` handlers, each in its own try/catch — a browser that doesn't support one action (historically `seekto` on iOS Safari) must not abort registration of the ones after it. `seekbackward`/`seekforward` are registered **only for a single-track playlist** and explicitly set to `null` otherwise: iOS shows a limited set of system buttons and, when the seek actions are present, renders the ±10-second buttons *instead of* track-skip — so a multi-track playlist can't be skipped from the lock screen. `play`/`pause` call the `<audio>` element directly, never the in-app toggle/store: `isPlaying` is derived **only** from the element's own `play`/`pause` events (never set by hand from `toggle`/`next`/`prev`), so the lock-screen button and the in-app button can't disagree with what's actually playing.

**The `<audio>` element is registered in the store by a callback ref**, not by a mount effect: the player renders nothing (including the element) while no playlist is loaded, so an effect with empty deps captures `null` and never re-runs. A `null` `audioEl` made `toggle()` return silently (the pause button looked dead) and made `seek()` skip the element entirely, so the next `timeupdate` dragged the scrubber back to the real position. Seek de-duplication (the same gesture commits via `pointerup`+`mouseup`+`touchend`) compares against the stored **seek target**, not `audioEl.currentTime`: the element updates `currentTime` synchronously but fires `seeked` later, so comparing against it cleared `isSeeking` early and reintroduced the same snap-back.

**Boundaries (see ARG-139 for the full list).** No shared track library — a playlist's tracks are exactly what its author attached, nothing is reused across playlists. No drag-and-drop reordering in the composer — order is attachment order. No background playback / HLS for these tracks (still whole-file presigned playback, same as any other audio).

**Offline listening (ARG-145).** A «Скачать офлайн» button on `PlaylistCard` (chat/task/KB — same component everywhere) downloads every track's bytes with a plain `fetch` (not the presigned-URL that expires) and stores each as a `Blob` in IndexedDB, keyed by `media_asset_id` (`lib/idb.ts`, store `playlistOffline`, `DB_VERSION` 4) — the same file shared by two playlists downloads once. Status (`idle`/`downloading`/`done`/`error`) and per-playlist progress live in a small Zustand store (`stores/offlinePlaylists.ts`), not in the card component, so they survive the card unmounting (virtualized message list) without re-hitting IndexedDB on every render. Download is whole-playlist, not per-track, and idempotent — a track already in the store is skipped, so an interrupted download just resumes on retry.

`GlobalPlayer`'s track-change effect now checks `lib/offlinePlaylists.ts::getOfflineTrackUrl` first: if the asset has a locally stored `Blob`, it plays from `URL.createObjectURL(blob)` instead of the presigned-URL, transparently to the rest of the player (seek/queue/media-session code is unchanged). Object URLs are cached in-memory per `asset_id` so repeated lookups return the same string — a fresh `URL.createObjectURL` every render would look like "the track changed" to the effect that diffs `el.src`. Background playback (screen locked / app backgrounded) rides the existing `<audio>` + `navigator.mediaSession` from ARG-139 as-is; no new Wake Lock or Service Worker infrastructure was added for this.

Playing an un-downloaded track while offline is surfaced explicitly rather than hanging silently: `PlaylistCard`'s track click checks `navigator.onLine`, and the `<audio>` element's `onError` handler also toasts «Нужна сеть» — covering both the case where an offline user never attempts playback and the case where a partially-downloaded playlist fails mid-queue.

**Downloaded-playlists registry and Profile list (ARG-153).** `playlistOffline` (the store above) only holds track bytes keyed by `media_asset_id` — it cannot say *which playlists* are downloaded, only which files happen to be. A second store, `playlistOfflineMeta` (`lib/idb.ts`, `DB_VERSION` 7), keyed by `playlist_id`, holds a `{ playlist: PlaylistOut, downloadedAt }` snapshot written at the end of `downloadPlaylist()` — enough to render a card and start playback without a network round-trip. `lib/offlinePlaylists.ts::listDownloadedPlaylists()` reads the whole registry sorted by `downloadedAt` descending; `removeDownloadedPlaylist(playlistId)` deletes the registry row and the track blobs, but only the ones no *other* still-downloaded playlist still needs (tracks can be shared between playlists, same as the download path dedupes by `asset_id`). `stores/offlinePlaylists.ts` exposes this as `downloaded`/`loadDownloaded`/`remove`, refreshed after every download. `ProfileScreen` renders `DownloadedPlaylistsSection` between «О себе» and the Dynamics block when the registry is non-empty (hidden entirely when empty, same pattern as `DynamicsSection` returning `null`); tapping an entry calls `playPlaylist(playlist, 0)` directly — no in-place card, no track picker. Playlists downloaded before this registry existed have no snapshot and do not appear until re-downloaded — that migration was explicitly out of scope. Logout clears both stores together (`clearOfflinePlaylists`).

Logout clears the whole `playlistOffline` store (`clearOfflinePlaylists`, wired into `features/auth/api.ts::logout` next to `clearMediaCache`) — same reasoning as the SW media cache cleanup above: the tracks are private and the device may be shared. There is no per-playlist or by-size eviction — clearing is all-or-nothing, on logout only.

## Fast delivery in feeds

- Presigned URLs are embedded **in the message payload** (`MessageOut.attachments`: url + thumb_url + metadata, batch-signed via `resolve_attachments`), not fetched per asset — kills N round-trips on mobile. Access is gated by the room (whoever reads the message reads its attachments). `attachment_ids` kept for backward compatibility.
- Feeds load the thumbnail; the original loads on click (lightbox). Images render as a plain native `<img>` — **no `loading="lazy"`**: native lazy-loading is unreliable inside the feed's nested scroll container (`.messages { overflow-y: auto }`, not page-level scroll) on mobile WebKit/Chrome-standalone (installed PWA) — the image can simply never start fetching. Desktop masked this for a long time since it doesn't have the bug. Stickers (`MessageItem.tsx`) load through the same presigned-URL/bucket path without `loading` and are unaffected, which is how this was diagnosed. No blob-progress fetch, no spinner; the box gets an **explicit pixel width** computed from the row's `width`/`height` (`feedBoxWidth` in `Attachment.tsx`, fitting the image into 280×360), and its height comes from the image's own `width`/`height` attributes with `height: auto` in CSS. **Never size the box from the image itself** (the earlier `aspect-ratio` on the wrapper + `height: 100%` on the `<img>`): the wrapper is a flex item, so its width came from the not-yet-loaded image while the image's height came from the wrapper — on WebKit (iOS Safari and the installed PWA) that cycle collapsed the box to a thin line and was **never re-resolved once the bytes arrived**, so the photo stayed invisible however long you waited, even though the gateway log showed the thumbnail served `200` in full. Re-entering the room "fixed" it only because the second layout pass already knew the image's size from the browser cache; a full PWA kill brought the bug back. `VideoPlayer` never had it — its box is `width: min(...)` in CSS with the media absolutely positioned, which is the same rule. Legacy rows without dimensions get a placeholder box (`.attImagePending`) until `onLoad`, where `naturalWidth`/`naturalHeight` pin the exact width (see backfill below). **In the lightbox**, the original image is fetched with a **download progress bar**: `useImageDownload` streams it via `fetch` + `ReadableStream` (received / `Content-Length`) and shows a % overlay while it loads, then swaps in the finished blob — a native `<img src>` gives no progress, so on a slow link the user sees the bar instead of a blank frame. Best-effort: no stream / no `Content-Length` / fetch failure → falls back to the direct `src`. Lightbox **video** stays native (`<video>` streams with range requests, so seeking and start-before-fully-loaded keep working — a download % of the *whole file* would be wrong for a stream), but shows a **buffering indicator** over the frame while it isn't yet playable (`LightboxVideo` in `Overlay.tsx`): a spinner until `duration` is known, then a «буфер NN%» bar from `video.buffered / duration` around the current position. It hides once the video is playable (`readyState ≥ HAVE_FUTURE_DATA` / `canplay` / `playing`) and reappears on `waiting`/`seeking`.
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

## Снимок инфраструктуры (`GET /api/metrics/system`)

Соседний измерительный слой: не «где теряется время в медиа», а «что с инфраструктурой
прямо сейчас». Источники уже были в системе, но никем не читались. Только админу; сбор —
`app/services/system_metrics.py`, считается на лету при запросе (гейджей мало, запрос
редкий — фонового сборщика нет).

Блоки ответа:

- `transcode_queue` — `pending` (LLEN `transcode:pending`), `inflight` (размер
  `transcode:inflight`), **`stale`** (забраны дольше `transcode_claim_timeout_seconds`
  назад — воркер упал/завис; раньше выводилось глазами из логов), `retrying`
  (`transcode:attempts` > 1), `oldest_claim_age_seconds`. Только чтение — механику
  очереди эндпоинт не трогает.
- `presence` — `online_users` (SCARD `presence:online`, общее по всем воркерам) и
  `ws_connections_this_process` (локальный реестр `ws/manager.py`; при N воркерах это
  доля одного процесса, отсюда имя).
- `db_pool` — `size` / `checked_in` / `checked_out` / `overflow` / `max_overflow` + сырой
  `status()`. **`pool_size` в `app/db/session.py` не задан** — работает дефолт SQLAlchemy
  (5 + 10 overflow), поле `size_is_sqlalchemy_default: true` это фиксирует. Крутить его
  без цифр не нужно, но видеть обязательно: упёршийся пул выглядит как «внезапно всё
  встало» и ничем другим себя не проявляет.
- `redis` — `ping_ms` (round-trip) и память из `INFO memory`.
- `disk` — `total/used/free_bytes`, `used_percent` и `growth_bytes_per_hour` по разнице с
  предыдущим снимком (базовая точка в Redis `metrics:system:disk`, сдвигается не чаще
  5 минут; пока базы нет — `null`, а не выдуманный ноль). Путь — `METRICS_DISK_PATH`
  (дефолт `/`): том MinIO в бэкенд-контейнер не смонтирован, но лежит на той же ФС
  docker-хоста, так что свободное место — общий пул.

Сбой отдельного источника отдаётся как `{"error": ...}` внутри своего блока, снимок всё
равно приходит: диагностика нужна ровно тогда, когда часть инфраструктуры лежит.
Порогов и алертов здесь нет — только цифры.

**nginx `log_format api_perf`** — те же тайминги, что у `media_perf`, но на API-локации
(`location /api/`): `req_time` (весь запрос) против `upstream_time` (сколько думал
бэкенд) — это и есть разделение «медленный бэкенд» vs «медленная сеть», которого раньше
не было нигде, кроме медиа. Плюс `proto=$server_protocol` — доля HTTP/3. Пишется в
stdout: `docker logs <nginx> | grep api_perf` (у контейнера нет тома под
`/var/log/nginx`, файл умер бы вместе с контейнером и не ротируется). Дефолтный
access.log не отключён, поэтому API-запрос даёт две строки — обычную и `api_perf`.
Формат стабилен, на него завязан этот грепанье.

⚠️ `docker/deploy.sh` **не применяет** изменения nginx — нужно ручное пересоздание
контейнера/`nginx -s reload` (известное ограничение, ARG-22). Без этого шага `api_perf`
на сервере не появится, остальное (эндпоинт) работает.

## Backfill (one-off)

Older images uploaded before thumbnails have `thumb_key = NULL`. `backend/scripts/backfill_thumbnails.py` regenerates them (idempotent, batched, images only; videos are client-posters). Runbook in the archived OPERATIONS §4.

Older images uploaded before the client sent dimensions have `width`/`height = NULL` — the feed can't reserve an `aspect-ratio` box for them, causing layout shift. `backend/scripts/backfill_image_dims.py` pulls the **original** (not thumb) from MinIO and reads its size via Pillow (idempotent — only touches `kind='image'` rows with `width IS NULL OR height IS NULL`; batched; best-effort, broken/missing objects are skipped and logged). Same runbook pattern as `backfill_thumbnails.py`.

**Historical derivatives (video 720p variant + audio AAC variant + image `preview_key`)** — `backend/scripts/backfill_media_derivatives.py`. Prod measurements showed ~90% of media traffic was full-size originals while only a handful of objects had a variant, and the `preview_key`/audio-transcode features shipped without a backfill. The script catches all three up **one object at a time**, so a ~20–30-user platform doesn't notice:

- **No second transcoder.** For video/audio it feeds the *existing* worker queue with the same call the upload path uses (`transcode_queue.enqueue`): enqueue one job → poll `media_assets.transcode_status` until it is terminal (`done`/`failed`) → sleep → next. The worker stays single-job, ffmpeg never fans out. **A live `transcode-worker` is required** — without it jobs just sit in the queue and each object fails on `--job-timeout-seconds` (default = `TRANSCODE_CLAIM_TIMEOUT_SECONDS`).
- **Images** call the same `generate_image_preview` as confirm, also one at a time.
- **Resumable from DB state only** (`transcode_status`, `variant_key`, `preview_key`) — no progress file; interrupt and rerun to continue. Video/audio candidates are `kind IN (video, audio) AND variant_key IS NULL AND transcode_status IS NULL` (live `processing` rows are left to the worker; `failed` only with `--retry-failed`, which resets the status to NULL first because the worker acks `failed` jobs without work). Image candidates are `kind='image' AND preview_key IS NULL` — note this set also contains images whose derivative legitimately came out heavier than the source, so they are re-attempted on every run (cheap, and the outcome is the same NULL).
- **Dry-run by default**: without `--apply` it only prints the plan (count + total bytes per kind). Flags: `--videos` / `--audio` / `--images` (none = all three), `--limit N` (per kind), `--delay-seconds` (default 30), `--job-timeout-seconds`, `--retry-failed`.
- **Additive only** — originals are never deleted or overwritten. Per-object failures are logged and skipped; SIGINT finishes the current object and exits with a summary.
- **Voice messages specifically:** this is how the WebM/Opus voice messages already sitting in existing chat rooms (recorded before this feature shipped) become playable on iPhone — no resend needed. Run `--audio --apply` once the worker is live.
