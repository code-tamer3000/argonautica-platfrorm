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

## After submitting: экспедиция пройдена (`users.graduated_at`)

Submitting sets `users.graduated_at` (timestamptz, once, never cleared) — a second
flag with the opposite meaning to `survey_required`: the platform is **not** closed,
but the path is over. Rules live in one place, `app/services/graduation.py`
(`is_graduated` / `assert_not_graduated` / `GRADUATED_MESSAGE`):

- **Dynamics disappears** for the graduate: the `/api/dynamics` router sits behind
  `require_ongoing_participant` → 403, and the profile drops `DynamicsSection`.
  The admin keeps the row in `/admin/dynamics` — frozen as of the graduation day
  (`_calc_stats(..., today=graduated_on)`), badged «Прошёл Экспедицию», sorted last
  and excluded from the summary counters. See [DYNAMICS.md](DYNAMICS.md).
- **Tasks collapse to what was submitted, plus a one-time chance to catch up**:
  visible tasks are `submitted`/`accepted` (`GRADUATE_VISIBLE_STATUSES`) or still
  `assigned`/`returned` (`GRADUATE_BACKFILLABLE_STATUSES`, ARG-157) — the latter can
  still be submitted/commented on once, then close for good; review of someone
  else's cross-task and every other stream write stay → 403. See [TASKS.md](TASKS.md).
- **A first-login popup after submitting** (`GraduationPopup.tsx`, `settings.graduation_popup_dismissed`,
  same dismiss pattern as `WelcomePopup`/`LimboPopup`) points at the backfillable
  tasks, the gift PDF, and the newly-opened «Факел». On the dashboard, the graduate's
  Dynamics widget slot is replaced outright by a download button for the same gift
  PDF (`ExpeditionArtifactCard.tsx`) — see [EXPEDITION.md](EXPEDITION.md).
- **Рубка becomes read-only**: full history everywhere (DMs, diary, channels), no
  writing — `assert_can_write` refuses with `GRADUATED_MESSAGE`, WS `typing` is
  dropped, and the composer is replaced by the «Аргонавт, ты прошёл Экспедицию»
  notice. See [MESSAGES.md](MESSAGES.md).

Каюта is deliberately untouched — it is private journaling, not part of the
expedition track.

The repair branch of `POST /api/survey` (a response already exists) commits before
raising 409: `get_session` rolls back on exceptions, so clearing `survey_required`
and backfilling `graduated_at` has to be committed explicitly. The migration
backfills `graduated_at` from `survey_responses.created_at` for people who submitted
before this release.

## Questions

The canon lives in `app/services/survey_form.py` (`SURVEY_VERSION`), never on the
frontend: the screen and the admin panel both render from `question_form()`.
Changing the question set means bumping `SURVEY_VERSION`; old answers stay readable
under their own version, no data migration.

One page, all questions in a row — no steps, no scales, no ratings: the survey asks
people to tell it in their own words. Current canon (v2, second stream): 8 questions —
что изменилось · поворотная точка · форматы ведения дневника · стихии (множественный
выбор + почему) · «слишком/не хватило» · геймификация Платформы · платформа и что
чинить · отзыв для публикации. v1 (first stream) had 9: two of these — «открытость
дневника видит когорта» and «где сыпался ритм» — were dropped and merged into the v2
gamification question; old v1 answers stay stored and readable under their own
`version`, just not re-rendered under the current canon's keys.

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
| `POST ` | Submit. Validates, writes `survey_responses`, clears `survey_required`, sets `graduated_at`, notifies admins (`survey_submitted`, burst-collapsed — see [NOTIFICATIONS.md](NOTIFICATIONS.md)). Second attempt → 409 (and repairs both flags) |
| `GET /gift` | Presigned link to the personal book. 403 before submitting, 404 if no book is attached yet |

The gift URL is signed directly via `presigned_get_url(..., download_name=...)`,
bypassing `assert_media_access`: the book has its own access rule (survey submitted
+ asset attached to *this* user), which the generic media checker knows nothing about.
Download name is `<username>.pdf`.

Admin (`/api/admin`, whole router under `require_admin`):

| Endpoint | Behavior |
|---|---|
| `GET /survey` | Form + one row per non-admin: invited / completed_at / publish_consent / has_gift / answers / plan_id+plan_name / intake_id+intake_starts_on, plus counters |
| `POST /survey/invite` | `{user_ids}` → raise the flag in bulk. Skips people who already submitted (they would hit 409 and stay locked out) and admins |
| `DELETE /survey/invite/{user_id}` | Drop the flag without waiting for an answer |
| `PATCH /survey/gift/{user_id}` | `{media_asset_id}` — attach the book, `null` detaches |

## Admin flow

`/admin/survey` has two tabs: «Кому показать» (participant list with checkboxes,
status badges) and «Ответы» (questions labelled from the canon, two view modes).
No name/username search — it went unused and was dropped.

Both tabs share the same поток + тариф filters (`SurveyFilters`). Поток is a plain
`<select>`, defaulting to the active intake. Тариф is a multi-select checkbox group
tucked behind a small dropdown button (`PlanFilterDropdown`, same click-outside-closes
idiom as `components/KebabMenu.tsx`) rather than sitting exposed on the page — several
tariffs can be checked at once. The dropdown sorts the cheapest tariff (`Plan.is_cheap`,
e.g. «Наблюдатель») to the bottom — same convention as the contacts roster
(`app/api/users.py::list_contacts`) — since almost nobody on it ever submits.
«Выбрать всех в тарифе» (invite tab only, enabled once at least one тариф is checked)
bulk-selects everyone matching the current filters who hasn't submitted yet, alongside
the existing «Выбрать всех несдавших».

«Ответы» has two view modes: «по человеку» and «по вопросу».

«По человеку» starts fully collapsed — one row per participant showing just the name;
clicking «Развернуть» opens their full answer card, and each individual question inside
that card can be collapsed/expanded on its own (`PersonAnswers`/`PersonAnswerBody`) —
useful for skimming past answers already read without losing the rest of the card.

«По вопросу» is one block per question with every participant's answer to it — reading
all answers to a single question across the whole stream without scrolling past
unrelated ones. Its block does NOT reuse `.listItem` (a row-flex layout) — it has its
own standalone box styling, since combining a row-flex class with the column layout
these blocks need broke the layout.

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
