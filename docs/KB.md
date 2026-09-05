# Knowledge Base

> Source: docs/archive/{PLATFORM_SPEC.md §4.9, DATA_MODEL.md, DECISIONS.md, PROGRESS.md st.8/19}, restructured 2026-07-06.
> Endpoints: `/api/kb`. Tables: `kb_items`, `kb_item_media`, `kb_comments`, `kb_categories` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/kb.py`.

The second half of the product: the author's materials (markdown + files/video), read by participants.

## Categories (flat)

One level only — an item has at most one category (`kb_items.category_id`, nullable
FK → `kb_categories`; `NULL` = «Без категории» section). Admin-only CRUD; any
participant sees the category list to group the item list.

- `GET /categories` — list (`sort_order`, then `id`), visible to any participant.
- `POST /categories` / `PATCH /categories/{id}` / `DELETE /categories/{id}` — admin only.
- Deleting a category is non-destructive: it first sets `category_id = NULL` on its
  items (avoids the FK), then removes the category. Items are never deleted with it.
- Assigning: `category_id` is a whitelisted field on `POST /items` and `PATCH /items/{id}`;
  a non-existent id → `404` (`assert_category_exists`). Set to `NULL` to unassign.
- Frontend: `KbList` groups cards by category (empty categories hidden, «Без категории»
  last; headings suppressed when everything is uncategorized). Admin panel has a
  «Категории» manager (add/rename/delete) and a category `<select>` on the item form.

## Authoring (admin only)

- `POST /items` — draft by default. `PATCH /items/{id}` — whitelist fields. `DELETE /items/{id}` — bulk-deletes link rows first (FK), then the item.
- `POST /items/{id}/media` — idempotent link to a `media_asset` (files uploaded via the normal media flow, see [FILES.md](FILES.md)). `DELETE /items/{id}/media/{asset_id}` — unlink.

## Reading (any participant)

- `GET /items` — participants see only `published`; admin sees all (`media_asset_ids` batched, no N+1).
- `GET /items/{id}` — a draft is `404` for non-admin (existence not revealed).
- Access helpers: `load_kb_item` / `assert_kb_item_visible` / `attached_media_ids`.

## Media access via publication

- `assert_media_access` grants any participant a presigned-GET to an asset attached to a **published** item (through the normal `GET /api/media/{id}`). Unlinking or unpublishing closes access. See [FILES.md](FILES.md).

## Isolation by intake and plan (ARG-96)

A published item can still be scoped: `kb_items.intake_id` (NULL = every intake) and
`kb_item_plans` (empty = every plan of the user's intake) both gate visibility — see
[DATA_MODEL.md](DATA_MODEL.md) "Content isolation by intake and plan". Checked in
`assert_kb_item_visible` (and mirrored in `GET /items`' query filter) with the **same 404**
as a draft — a foreign-intake/plan item doesn't reveal its existence any more than an
unpublished one does. `assert_media_access` applies the same double filter to the item(s) an
asset is attached to. `POST /items` and `PATCH /items/{id}` accept `intake_id`/`plan_ids`.

## Markdown reader (attached `.md` files)

There is **no separate "book" material type** — every item is a normal article.
The reader is a property of an **attachment**: whenever an article has a `.md`
file attached (linked as a normal `media_asset`), that file gets a «Читать» button
that opens a full-screen chapter reader. Nothing changes server-side.

- Detection is frontend-only: `MdAttachment` resolves each attachment's presigned
  URL and treats it as markdown if the filename ends `.md`/`.markdown`
  (`isMarkdownUrl`). A markdown attachment renders the usual download link **plus**
  a «📖 Читать» button; other files render as before.
- Reader route: **`/kb/read/:itemId/:assetId`** (`KbBookReader`, lazy-split in
  `AppShell`). It fetches the markdown bytes from the file's presigned URL and
  `parseBook()` splits them into **chapters on the `##` headings** (leading `# …` =
  title, text before the first `##` = a preface chapter). Layout: a TOC rail +
  reading column with IntersectionObserver chapter tracking and `?ch=N` / `#slug`
  deep-links (used from a Gene Key reading — see [GENE_KEYS.md](GENE_KEYS.md)).
- Authoring: attach the `.md` via the normal media flow — no special UI. To convert
  an existing HTML book to a chapterized `.md`, `frontend/scripts/book_html_to_md.py`
  turns a FictionBook-style export into one markdown file (one `##` per chapter).
- Visibility/access for the `.md` follow the standard media-via-publication rules
  above; the reader just renders what the presigned URL returns.

## Позиция просмотра видео (ARG-118)

Видео-вложения материалов КБ запоминают, где остановился каждый пользователь —
`kb_video_progress` (`kb_item_id`, `media_asset_id`, `user_id`, `position_seconds`,
`updated_at`; составной PK). Ключ — тройка, а не только asset: один и тот же файл
может быть прикреплён к нескольким материалам сразу (`kb_item_media`), и позиция не
должна путаться между статьями.

- `GET /api/kb/items/{item_id}/media/{asset_id}/progress` — своя сохранённая позиция
  (`position_seconds: null`, если записи нет).
- `PUT .../progress` — сохранить позицию (создаёт или обновляет запись).
- `DELETE .../progress` — сбросить (вызывается фронтом на `ended` — досмотрел до конца,
  следующий раз начинается сначала).
- Все три эндпоинта проверяют видимость материала (`assert_kb_item_visible`) и что
  файл привязан к нему и имеет `kind='video'`, иначе `404`.
- Записи каскадно чистятся руками (без `ON DELETE CASCADE`, тем же приёмом, что и у
  `kb_item_media`/`kb_item_plans`) при удалении материала и при отвязке медиа.
- Фронтенд: `VideoPlayer` принимает необязательный проп `kbProgress={{itemId, assetId}}`,
  который передаёт `Attachment`/`MdAttachment` только внутри материала КБ (`KbViewer`).
  Видео в чате, задачах и Каюте эту позицию не запоминают — проп там не передаётся.
  Восстановление — на `loadedmetadata`, сохранение — троттлингом (раз в 5с) на
  `timeupdate` + сразу на `pause` и при размонтировании плеера.

## Comments

- Flat comments under an item: `GET/POST /items/{id}/comments`, `DELETE /comments/{id}`.
- Soft delete (`kb_comments.deleted_at`), by author or admin.
