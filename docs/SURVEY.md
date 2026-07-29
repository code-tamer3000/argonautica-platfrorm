# Exit survey (выпускная анкета экспедиции)

Feedback collected at the end of a stream, while the impression is fresh. The admin
marks participants; on their next request the **whole platform is gated** by the
survey screen. After submitting, the person gets a gift — a personal PDF book of
their path through the expedition.

Not to be confused with `feedback` (раздел «Поддержка», bug/improvement reports —
see [SUPPORT.md](SUPPORT.md)). Different table, different lifecycle.

## The gate

`users.survey_required` is the single flag. It is enforced in exactly one place:

- `api/deps.py::get_current_active_user` → 403 `Survey required`. Since every
  domain router depends on it, the flag closes the entire API at once — the same
  mechanism as `must_change_password`.
- `ws/chat.py` rejects the WS handshake on the same flag.

Reachable while gated (they hang off `get_current_user`, not `..._active_user`):
`GET /api/auth/me`, `POST /api/auth/change-password`, and all of `/api/survey`.
Without that exception the survey endpoints would be blocked by the very gate they
lift.

Frontend mirror: `AuthGuard` renders `SurveyScreen` instead of `AppShell` when
`user.survey_required` — right after the `must_change_password` branch.

## Questions

The canon lives in `app/services/survey_form.py` (`SURVEY_VERSION`), never on the
frontend: the screen and the admin panel both render from `question_form()`.
Changing the question set means bumping `SURVEY_VERSION`; old answers stay readable
under their own version, no data migration.

One page, all questions in a row — no steps, no scales, no ratings: the survey asks
people to tell it in their own words. 9 questions: что изменилось · поворотная точка ·
форматы ведения дневника · стихии (множественный выбор + почему) · «слишком/не
хватило» · открытость дневника · где сыпался ритм · платформа и что чинить ·
отзыв для публикации.

Question kinds and the shape of their answer in `answers` JSONB:

| kind | answer |
|---|---|
| `text` | `{"text": str}` — `min_length`/`max_length` enforced |
| `multi` | `{"choices": [option_key], "comment": str?}` — stored in canon order, foreign keys dropped |

`validate_answers()` rejects unknown keys, missing required answers and short texts,
collecting all problems into one 422 instead of walking the user through them one
at a time. Empty optional answers are dropped rather than stored as null.

Consent to publish is a column (`publish_consent`), not a question — the admin
filters by it without digging into JSONB.

## Endpoints

User (`/api/survey`, all on `get_current_user`):

| Endpoint | Behavior |
|---|---|
| `GET /me` | Form canon + `completed_at`, `required`, `gift_available` |
| `POST ` | Submit. Validates, writes `survey_responses`, clears `survey_required`. Second attempt → 409 |
| `GET /gift` | Presigned link to the personal book. 403 before submitting, 404 if no book is attached yet |

The gift URL is signed directly via `presigned_get_url(..., download_name=...)`,
bypassing `assert_media_access`: the book has its own access rule (survey submitted
+ asset attached to *this* user), which the generic media checker knows nothing about.
Download name is `<username>.pdf`.

Admin (`/api/admin`, whole router under `require_admin`):

| Endpoint | Behavior |
|---|---|
| `GET /survey` | Form + one row per non-admin: invited / completed_at / publish_consent / has_gift / answers, plus counters |
| `POST /survey/invite` | `{user_ids}` → raise the flag in bulk. Skips people who already submitted (they would hit 409 and stay locked out) and admins |
| `DELETE /survey/invite/{user_id}` | Drop the flag without waiting for an answer |
| `PATCH /survey/gift/{user_id}` | `{media_asset_id}` — attach the book, `null` detaches |

## Admin flow

`/admin/survey` has two tabs: «Кому показать» (participant list with checkboxes,
search, status badges) and «Ответы» (cards per participant, questions labelled from
the canon).

Books are uploaded through the ordinary presigned media flow (`mediaUpload`, kind
`file`). Uploading a batch matches each file to a participant by filename
(`<username>.pdf`) — that is how the artefact generator lays them out. Per-row upload
overrides the match.

## Frontend

- `src/features/survey/SurveyScreen.tsx` — intro → one page of questions → submit.
  Draft is kept in `localStorage` (`survey:draft:v1`): the form is long, a reload must
  not wipe it. Validation mirrors the backend rules so people don't submit into a 422.
- `src/features/survey/SurveyDone.tsx` — thanks + «Скачать книгу (PDF)» via
  `lib/mediaUpload.ts::downloadFile` (cross-origin `<a download>` is ignored by
  browsers, and `target=_blank` opens a blank tab in iOS PWA).
- `src/features/profile/SurveyGiftSection.tsx` — the book in the personal cabinet
  (`/profile`). The thank-you screen shows once and never again, so this is the only
  lasting entry point — and the only place a person sees a book attached *after* they
  submitted. Hidden until the survey is submitted.
- `src/api/survey.ts` — user and admin hooks.

After a successful submit the screen calls `refreshMe()`, otherwise the stale
profile would put the gate back on the next reload.
