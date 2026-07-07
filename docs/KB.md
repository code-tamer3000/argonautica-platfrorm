# Knowledge Base

> Source: docs/archive/{PLATFORM_SPEC.md §4.9, DATA_MODEL.md, DECISIONS.md, PROGRESS.md st.8/19}, restructured 2026-07-06.
> Endpoints: `/api/kb`. Tables: `kb_items`, `kb_item_media`, `kb_comments`, `kb_categories` (see [DATA_MODEL.md](DATA_MODEL.md)). Service: `services/kb.py`.

The second half of the product: the author's materials (markdown + files/video), read by participants. **Categories are out-of-MVP** — items are flat (`category_id = NULL`).

## Authoring (admin only)

- `POST /items` — draft by default. `PATCH /items/{id}` — whitelist fields. `DELETE /items/{id}` — bulk-deletes link rows first (FK), then the item.
- `POST /items/{id}/media` — idempotent link to a `media_asset` (files uploaded via the normal media flow, see [FILES.md](FILES.md)). `DELETE /items/{id}/media/{asset_id}` — unlink.

## Reading (any participant)

- `GET /items` — participants see only `published`; admin sees all (`media_asset_ids` batched, no N+1).
- `GET /items/{id}` — a draft is `404` for non-admin (existence not revealed).
- Access helpers: `load_kb_item` / `assert_kb_item_visible` / `attached_media_ids`.

## Media access via publication

- `assert_media_access` grants any participant a presigned-GET to an asset attached to a **published** item (through the normal `GET /api/media/{id}`). Unlinking or unpublishing closes access. See [FILES.md](FILES.md).

## Comments

- Flat comments under an item: `GET/POST /items/{id}/comments`, `DELETE /comments/{id}`.
- Soft delete (`kb_comments.deleted_at`), by author or admin.
