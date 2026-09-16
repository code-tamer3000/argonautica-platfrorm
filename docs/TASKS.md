# Tasks (раздел «Задачи»)

> Source: backend/app/{models/task.py, api/tasks.py, services/tasks.py} + docs/archive/PROGRESS.md st.22, restructured 2026-07-06.
> Endpoints: `/api/tasks`. Tables: `tasks`, `task_media`, `task_assignments`, `task_submissions`, `task_submission_media`, `task_comments` (see [DATA_MODEL.md](DATA_MODEL.md)).

Author assigns work; participants submit; admin reviews. A task is **common** (`type='common'` — visible to every active participant, anyone may submit), **individual** (`type='individual'` — addressed to specific users via `task_assignments`), or **pair** (`type='pair'` — peer-learning; see "Pair tasks" below).

> **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)) have no access to Задачи at all: the whole `/api/tasks` router is behind `require_participant` → 403.

> **Graduates** (`users.graduated_at`, see [SURVEY.md](SURVEY.md)) keep the section as an archive of what they handed in: `list_tasks` and `assert_task_visible` narrow it to tasks whose own assignment is `submitted`/`accepted` (`GRADUATE_VISIBLE_STATUSES` in `services/tasks.py`) — `returned`/`assigned` and untouched common tasks disappear, since they can no longer be worked on. Writing is closed too: new submissions, submission comments, review of a cross-task and every stream write → 403. `attention_count` is 0 and progress X/Y is counted over the submitted tasks only, so the denominator never points at tasks they cannot see.

## Isolation by intake and plan (ARG-96)

A **common** task can be scoped: `tasks.intake_id` (NULL = every intake) and `task_plans`
(empty = every plan of the user's intake) both gate visibility — see
[DATA_MODEL.md](DATA_MODEL.md) "Content isolation by intake and plan". Checked in
`assert_task_visible` and mirrored in `list_tasks`' query filter (and the
`compute_progress`/`attention_count` denominators, so a participant's progress bar and badge
don't count tasks outside their intake/plan). Individual/pair/stream tasks **ignore** these
fields — an explicit assignee/pair/stream member sees their task regardless of intake/plan,
because assignment is already a stronger, deliberate grant. `POST /api/tasks` and
`PATCH /api/tasks/{id}` accept `intake_id`/`plan_ids` (read only when `type='common'`).

**A common task the caller already `submitted`/`accepted` is exempt from the plan check too**
(`GRADUATE_VISIBLE_STATUSES`, same tuple graduates use) — `assert_task_visible` checks for an
existing `task_assignments` row in one of those statuses *before* touching `plan_visible`, and
returns immediately if found. Otherwise a participant's tariff being changed after the fact
(e.g. a punitive downgrade, see [ROOMS.md](ROOMS.md) "Tariff change cleanup") would 403 them
out of work they already handed in and had accepted — erasing history instead of just closing
off new tasks. `GET /api/tasks` already had this covered on the list side (its `my_individual`
subquery isn't type-filtered, so a common task with an assignment row rides along regardless of
plan) — the gap was specifically the single-task detail route, which used to 403/hang for the
assignee's own completed task.

**A common task not yet finished can also stay reachable past a downgrade — but only for 5 days
and only if the downgrade landed on the cheapest tariff.** That's Междумирье (see
[LIMBO.md](LIMBO.md)): `_effective_plan_id` (`services/tasks.py`) swaps in
`users.limbo_previous_plan_id` instead of the live `plan_id` for the common-task plan check,
for as long as `users.limbo_deadline_at` is set — used by `_visible_common_where` and
`assert_task_visible`'s common branch. `GET /api/tasks`'s own `visible_common` clause calls
`_visible_common_where(current_user)` rather than re-deriving the same plan filter inline (it
originally did, independently, straight off `current_user.plan_id` — the two fell out of sync
the moment Междумирье shipped: detail worked during the grace period, the list the participant
actually browses did not, silently re-hiding the task a request earlier than intended).
`compute_progress`/`attention_count` reuse the same helper too, so all four call sites agree.

The **Argonauts roster/profile task list** (`app/api/argonauts.py`, see
[ARGONAUTS.md](ARGONAUTS.md)) has a narrower, asymmetric version of this exemption: it uses
`_completed_common_where` rather than `_visible_common_where` for a card's already-
`accepted`/`submitted` tasks. The plan check there was being evaluated against the *viewer's*
plan, not the task owner's — so an admin (who typically holds no plan at all) or the profile
owner themself, after a downgrade, would lose sight of their own already-completed task for a
reason that has nothing to do with whether that completion should be visible. `_completed_common_where`
drops the plan check *only* for those two viewers (`current_user.role == 'admin'`, or
`TaskAssignment.user_id == current_user.id` i.e. viewing your own card) — a **third-party**
participant on a different tariff than the task's tag still can't see it on someone else's
profile, by design: leaking a tariff-scoped task's title/content to a viewer who was never
entitled to it would be the same IDOR the plan filter exists to prevent in the first place,
completed or not. Only intake (ARG-96) is dropped unconditionally for everyone.

## Assignments & lifecycle

- Individual tasks → `task_assignments` rows created at task creation. Common tasks → rows created **lazily on first submission** (implicit access, like channels). Exception: `intake_bot.py` assigns intake-tagged welcome tasks (`tasks.intake_id` set, `type='individual'`, created with zero recipients by `scripts/provision_second_intake.py`) to each new user right after their platform account is created — see [INTAKE_BOT.md](INTAKE_BOT.md).
- `task_assignments.status`: `assigned → submitted → returned → accepted`. `late` is set on the first submission after `deadline_at`.
- Submission history is kept (a return produces a new `task_submissions` row; the latest is the current one).
- `tasks.sets_display_name` (default false): if set, `create_submission` overwrites `users.display_name` with the submission's trimmed text on submit. No task id/title is hardcoded — only this flag, set directly by provisioning (not exposed on `TaskCreate`).

## Media

- **Prompt media** (`task_media`) — attached by admin to the task itself; mirror of `task_submission_media` (submission attachments). Both go through the shared `media_assets` / presigned flow (see [FILES.md](FILES.md)).
- `create_task` / `update_task` accept `media_asset_ids` → saved into `task_media`. `get_task` / `list_tasks` return `attachments` batch-signed via `resolve_task_attachments`.
- **Media access**: `assert_media_access` gates task media by task visibility — `common` → any participant whose intake/plan pass isolation (ARG-96); `individual` → assignee / admin.

## Review

- Admin review changes assignment status; a return writes a `task_comments` row (feedback) on the latest submission. Comments are soft-deleted.
- **Проверка (ARG-134)**: `GET /api/admin/review-queue` — every `task_assignments` row in `submitted` across ALL tasks at once, sorted by submission time (oldest first), each carrying the submitter's name/avatar/**plan** and the task title/type. Admin screen `/admin/review` (`AdminReview.tsx`, group «Прохождение», next to «Динамика») lists them; content lives in `ReviewQueuePanel.tsx` (`features/tasks/`), reused by a **«Проверка» shortcut link** in the `/tasks` page header (`TasksList.tsx`, admin only, badged with the queue length) that jumps straight to `/admin/review` — one click from where the admin already works, without dropping the admin-menu entry. Inside the panel, items are **grouped by the submitter's tariff** (`plan_id`/`plan_name` on `ReviewQueueItemOut`, ordered by `usePlans()` price order, a `null`/deleted-plan bucket rendered last as «Без тарифа») — before this grouping, everything sorted into one flat stream regardless of tariff, which made a single cohort hard to find once several were mixed in. Expanding a row lazily fetches that task's full track list (`GET /api/tasks/{id}/submissions`) and renders the same `TrackCard` component the per-task detail screen uses (exported from `TaskDetail.tsx`) — accept/return go through the same `POST /api/tasks/assignments/{id}/review`, no separate review path. This is a second entry point into the existing per-task review, not a replacement for it.

## Full roster for a common task, and per-assignee deadline (ARG-133)

- `GET /api/tasks/{id}/assignments` for `type='common'` returns the FULL set of participants who can see the task (same filter as `participant_count`: `role='participant'`, not `is_observer`, gated by intake/plan — ARG-96), not just those who already have a lazily-created assignment row. Untouched participants carry `assignment_id: null`, `status: null`. Each row also carries `display_name`/`avatar_url` (no more client-side lookup by id) and the assignee's `deadline_at` (see below). For `individual`/`pair`/`stream` the endpoint is unchanged — only real assignees, visibility there is already explicit membership.
- `task_assignments.deadline_at` — nullable per-assignee override, **common only**. `PATCH /api/tasks/{task_id}/assignments/{user_id}/deadline` (admin-only, 400 for non-common tasks) sets or clears (`deadline_at: null`) it; if the participant has no assignment row yet, one is created lazily (same path as `get_or_create_assignment`) so there's something to extend. Effective deadline = `services.tasks.effective_deadline(task, assignment)` — `assignment.deadline_at ?? task.deadline_at` — used for `late`-flagging on submission, `deadline_soon`/`late` in `list_tasks`/`get_task` for the current viewer, and the overdue-tasks metric below. **Not** applied to the shared calendar deadline event (`sync_task_calendar_event`) — that event is one row per task, shared across every viewer; personalizing its date per assignee is out of scope (would need per-viewer calendar events, a different feature).
- Frontend: `RosterSection` in `TaskDetail.tsx`, admin-only, `type='common'` only. Collapsed by default (a common task's roster is often longer than the task itself — `▸/▾` toggle with a count, same pattern as the collapsible sections on `/tasks`); once open, split into «Не сдали» / «Сдали» (by `status == null`, common-only since an untouched common assignment row doesn't exist yet). Per row, the personal deadline text only renders when it actually differs from the task's own `deadline_at` (`hasDeadlineOverride`, comparing by value — the API only ever returns the *effective* deadline, never an explicit override flag) — showing the same value on every row would just repeat what's already at the top of the page. «Продлить срок» only on rows that haven't submitted yet (`status == null`; a submission's `late` flag is frozen at submit time, extending after doesn't change it); «Сбросить» only where an override is actually in effect, regardless of submission status.

## Просрочка задачи как метрика (ARG-130/ARG-128)

- `services.tasks.overdue_tasks_for(session, user)` — задачи, видимые участнику (common через `_visible_common_where`, individual/pair/stream через явное назначение), с прошедшим эффективным дедлайном и статусом `assigned`/`returned` — **включая** common-задачи без строки назначения вообще (implicit-доступ: не открыл к сроку тоже просрочка). Дедлайны раньше `OVERDUE_TASKS_SINCE` (константа в `services/tasks.py`, дата выката фичи) не учитываются — иначе выкат разом подсветил бы всю историю задач с прошедшим сроком всем участникам сразу.
- `services.tasks.late_submissions_count(session, user)` — сколько раз участник сдавал после дедлайна (`task_assignments.late = true`), считая с `users.discipline_reset_at` (NULL — с начала). Точка сброса пишется при входе/выходе из Междумирья — см. [LIMBO.md](LIMBO.md).
- `GET /api/dynamics/my-stats` (`MyDynamicsOut`) — `overdue_tasks: [{task_id, title, deadline_at}]` и `late_submissions_count`, рядом с пропусками дневника. `GET /api/admin/dynamics` (`UserDynamicsOut`) — агрегаты `overdue_tasks_count`/`late_submissions_count` на строку, плюс `limbo_eligible` (см. [LIMBO.md](LIMBO.md)). Обе метрики видны независимо от `plans.discipline_tracked` — флаг решает только подсветку кандидата в Междумирье, не саму видимость данных.
- `POST /api/tasks/{id}/submissions` возвращает `late`/`late_submissions_count` в `SubmissionOut` сразу в ответе на сдачу — фронт (`TaskComposer.tsx`) показывает попап-предупреждение «ещё N раз — и Междумирье» без второго запроса, если сдача оказалась поздней.

## Attention badge

- `attention_count` (in `list_tasks`, feeds the «Задачи» nav badge) = user's assignments not yet `accepted` (`assigned`/`submitted`/`returned`, common & individual) **plus** untouched common tasks (no assignment row yet). Accepting a task decrements it; when everything is accepted it is 0. A freshly assigned individual task increments it immediately. See `attention_count` in `services/tasks.py`.

## Progress counts (per task row)

`list_tasks` / `get_task` return per-task aggregates so the admin sees progress on the «Задачи» section itself (no need to open the management panel):

- `submitted_count` — assignments in `submitted`/`returned`/`accepted` (i.e. "сдали"); `accepted_count` — `accepted`; `unreviewed_count` — `submitted` only (awaiting review).
- `total_recipients` — the "из скольки" denominator: **individual/pair/stream** → assignee count; **common** → count of participants who can actually see the task (`participant_count` in `services/tasks.py`: `role='participant'`, not `is_observer`, gated by the same intake/plan filter as `assert_task_visible`/ARG-96), since common assignment rows are created lazily.
- `assignee_count` stays `individual`-only (null for common).

## Deadlines

- `tasks.deadline_at` is synced into `calendar_events` (`services/tasks.py`) so deadlines show on the calendar. Deadline events are **enriched** per viewer — see [CALENDAR.md](CALENDAR.md).

## Pair tasks (взаимное обучение)

`type='pair'` — a parent task where the admin splits users into **pairs** (`task_pairs` +
`task_pair_members`, tables in [DATA_MODEL.md](DATA_MODEL.md)). Admins may be in pairs too.
Endpoints live under `/api/tasks/{task_id}/pairs/...`.

- **Membership.** `task_pair_members` has `UNIQUE(task_id, user_id)` → one user is in at
  most one pair per pair-task. A pair is exactly two members. The parent pair-task gets a
  `task_assignments` row per member (so it flows through the normal status/badge/progress
  machinery); the pair completes for **both** members (assignment → `accepted`) when both
  cross-tasks are accepted — see `recompute_pair_completion` in `services/tasks.py`.
- **Meeting.** No in-app scheduling. A member sees "Спишитесь с @partner в личных
  сообщениях для назначения встречи." (2nd person); an admin viewing a pair they're not in
  sees "@X и @Y должны списаться …" (3rd person, both members named). The
  backend still carries `task_pairs.meeting_at` / `meeting_organizer_id` and the
  `PATCH .../meeting` endpoint (expand/contract — kept for compatibility), but no UI surfaces
  them anymore. Applies to existing pair-tasks too (frontend-only change).
- **Cross-task.** Each member gives their partner one task via `POST .../cross-task`: a
  normal `individual` task with `created_by`=the giving participant and `pair_id`=the pair;
  recipient is fixed (the partner). Exactly one per giver (repeat → 409). The giver may
  `PATCH .../cross-task/{id}` until the first submission (then 409). Submission/review reuse
  the standard flow.
- **Review authority.** A cross-task is accepted/returned by its **author** (the participant
  who gave it) **or** an admin — one is enough. `review_assignment` allows `created_by` of a
  `pair_id` task (not just admins); accepting/returning recomputes pair completion.
- **Visibility (anti-IDOR).** A participant sees only their own pair (partner, meeting, both
  cross-tasks); admin sees all pairs. `assert_task_visible` gates `pair` by membership and
  lets a cross-task's author see their own given task. Users in no pair don't get the task at all.
- **Admin edits.** Replace a member via `PATCH .../pairs/{id}` — allowed **only** before any
  cross-task exists in that pair (else 409). Delete a pair via `DELETE .../pairs/{id}` (hidden
  action): soft-deletes the pair, soft-deletes its cross-tasks (+ clears their deadline events),
  and drops the members' parent assignments.

## Поток (`type='stream'`)

Турнирная сетка слияний. Админ задаёт тему и выбирает участников; сервер строит сетку
(`build_bracket` в `services/stream.py`), участники пишут личный текст, подгруппа
согласует одну общую фразу, подгруппы сливаются вдвое — до единственного корневого узла.
Таблицы: `task_streams`, `task_stream_nodes`, `task_stream_node_members`,
`task_stream_texts`, `task_stream_options`, `task_stream_votes`
(см. [DATA_MODEL.md](DATA_MODEL.md)). Эндпоинты — `backend/app/api/stream.py`, префикс
`/api/tasks/{task_id}/stream` (роутер подключён ДО `tasks_router`).

- **Сетка.** Участники тасуются и режутся по 2; при нечётном числе последняя группа —
  тройка (13 = 5 пар + тройка). Узлы сливаются тем же способом до корня; `round` 1 —
  пары, `depth` — корень. `side`/`position` — только раскладка канвы: поддеревья корня
  дают ровно 8 слева и 8 справа для 16 участников. Членство денормализовано на все
  раунды (`task_stream_node_members`), поэтому «в каком узле раунда r этот юзер» — один
  запрос.
- **Продвижение ЛОКАЛЬНОЕ, глобальных стадий нет.** Подгруппа, закончившая работу, идёт
  дальше сразу и ждёт только соседей. Состояние нигде не хранится — выводится из
  сданных текстов и утверждённых фраз:
  - узел ГОТОВ (`ready`) выбирать фразу, когда все его члены сдали текст версии
    `round - 1`;
  - участник вправе писать версию `k`, когда утверждены все дочерние узлы его узла
    раунда `k+1` (своя подгруппа И соседние); для последней версии (`k == depth`)
    условие — утверждена корневая фраза. Это `current_version` / `waiting_on`.
  Отсюда «сделали и ждём соседей»: пара голосует, как только оба написали, а упирается
  лишь в соседнюю пару, когда приходит время переписывать текст.
- **Утверждение фразы.** Любой член готового узла предлагает вариант
  (`task_stream_options`), каждый голосует за один (`task_stream_votes`,
  `UNIQUE(node_id, user_id)` — переголосовать = UPDATE). Фраза утверждается при
  **единогласии** и после этого ФИКСИРУЕТСЯ: на неё уже опираются соседи сверху
  (она им видна и по ней переписываются тексты), поэтому переиграть её голосованием
  нельзя → 409. Зависший узел разруливает админ (`PATCH .../nodes/{id}/phrase`, пишет
  `approved_by`).
- **Комнаты.** Group-комната обсуждения заводится в момент готовности узла
  (`open_ready_node` → `ensure_node_room`), а не по общему переключателю, и
  ЗАКРЫВАЕТСЯ, как только фраза узла утверждена (`close_node_room`: снимаем
  `room_members`, шлём `room.closed`, `room_id` в ответе становится `null`). Этап
  пройден — обсуждать нечего; иначе у участника к финалу висело бы по чату на раунд.
  Сообщения остаются в БД, но недостижимы — см. [ROOMS.md](ROOMS.md).
  **Оверсайт админа.** Пока комната открыта, платформенный админ входит в неё —
  подсказать/подсмотреть обсуждение, хотя членом узла не является. Барьер снимает
  `assert_room_access` (services/rooms): для group-комнаты без членства пускает, если
  `user.role == "admin"` И это комната узла потока (`is_stream_node_room`). Строку
  `room_members` ему НЕ заводят — комната не всплывает в его списке чатов (`GET /rooms`),
  вход только по кнопке на карточке узла (`room_id` админу отдаётся). Метаданные комнаты
  фронт тянет `GET /api/rooms/{id}` (её нет в списке). Писать может, голосовать — нет
  (виджет `readOnly`). После закрытия комнаты доступ пропадает у всех, включая админа.
- **Дедлайн** у потока ОДИН, на всю задачу: обычный `tasks.deadline_at`, правится
  штатным `PATCH /api/tasks/{id}`. Отдельной ручки перехода стадии не существует.
- **Видимость (анти-IDOR).** Вся — в `services/stream.py`, ответ собирает
  `build_stream_out` под конкретного смотрящего:
  - личный текст версии `k` виден автору всегда; остальным — когда узел раунда `k+1`,
    общий у автора и смотрящего, набрал тексты ОТ ВСЕХ членов. То есть напарник
    открывается ровно тогда, когда сдали оба: пока кто-то не сдал, подсмотреть и
    подстроиться нельзя. Финальная версия открывается всем участникам, когда её сдали
    все;
  - фраза узла видна его членам и членам родительского узла — с момента утверждения
    (это и есть «видна фраза соседней подгруппы»); корневая — всем участникам;
  - `room_id` и `pending_member_ids` узла отдаются только его членам и админу; админ
    видит всё.
- **Назначения.** У каждого участника есть `task_assignments` на родительскую задачу —
  так поток попадает в бейдж/прогресс. Назначение переходит в `accepted`, когда участник
  сдал ФИНАЛЬНЫЙ текст (`mark_final_submitted`).
- **Тексты — только текст**, без вложений (в отличие от обычных сдач с MediaComposer).
- `task_streams.stage` — рудимент версии с глобальными стадиями, больше не читается и
  не пишется; колонку снимем отдельным релизом (expand/contract).
- **Админ голосовать не может** — он не член узла (`assert_node_member` исключений ему
  не делает; в комнату подгруппы `assert_room_access` пускает его на чтение/запись для
  оверсайта, но не как члена — голосовать нельзя). В `build_stream_out`
  ему грузятся варианты и голоса ВСЕХ готовых узлов, но это только обзор: на фронте
  вотбокс для не-своего узла рисуется в режиме `readOnly` (без кнопок), а его
  собственный инструмент — «Утвердить за подгруппу» (`force_phrase`) в блоке
  «Действия администратора» карточки узла.
- **Фронт.** `features/tasks/stream/`: `geometry.ts` (чистая раскладка, без React, по
  образцу genkeys/wheel.ts) + `StreamBracket.tsx` (SVG-сетка), `StreamPanel.tsx` (статус
  участника, композер, карточка узла, «ждём соседей», админ-блок), `StreamVoteBox.tsx`
  (голосование карточками — переиспользуется виджетом `StreamRoomWidget` в комнате
  подгруппы; голос и снятие своего варианта идут через подтверждение: фраза фиксируется
  единогласием необратимо, а снятие обнуляет отданные голоса), `AutoTextarea.tsx`
  (растущее под текст поле — в потоке пишут абзацы), `UserTextsModal.tsx` (версии
  участника свёрнутыми карточками, раскрыта последняя).

## Realtime

WS events: `task.created`, `task.updated`, `task.submission_new`, `task.submission_status`, `task.comment_new` (see the event list in [MESSAGES.md](MESSAGES.md)). Pair mutations (meeting, member replace, pair delete) fan out `task.updated` on the parent pair-task; no dedicated pair/meeting events. Stream mutations (текст, вариант, голос, продавленная фраза, переход стадии) — тоже `task.updated` на родительскую задачу; отдельных stream-событий нет. Плюс `room.created` на членов узла, когда сервер завёл комнату подгруппы, и
`room.closed` — когда фраза узла утверждена и комната закрылась.

## Dashboard widget

The landing screen (`GET /api/dashboard`, see [EXPEDITION.md](EXPEDITION.md)) shows a
"Задания экспедиции" card (`frontend/src/features/dashboard/TasksCard.tsx`) right after
the "Сегодня" card — a progress ring (`tasks_progress`, same numbers as `GET /api/tasks`)
plus the same up-to-5 `active_tasks` list already used elsewhere, but each row shows a
relative countdown ("сегодня" / "завтра" / "через N дней" / "без срока") instead of a
calendar date. Deliberately positive tone: an overdue task reads as "срок прошёл · ещё
можно сдать" in muted text, never red.

Rows that need attention — returned, overdue, or `deadline_soon` — get a thin gold rule
(`.itemFlag`) and are sorted to the top of the (already ≤ 5-item) list, in that priority
order (returned first: it's a direct action from someone, not just a ticking clock);
within the same priority the original `list_tasks()` order is kept (stable sort). Each
still gets a chip, but the chip is the only place colour carries meaning: `returned`
reuses the same blood-toned chip already shown on `/tasks` for that status (consistency,
not a new alarm colour); `overdue` and `soon` both use the calm teal `--color-more` chip
— overdue is *not* redder than "подходит срок", on purpose. A task the user has already
submitted (`my_status == 'submitted'`) doesn't appear in the row list (there's nothing to
*do*) but is counted separately in `tasks_in_review` and surfaced as "На проверке: N —
ждём ответа" so it doesn't look forgotten. No new tables, no push/scheduler — purely a
read-side reshuffle of numbers `list_tasks()` already computes.

## Отложенная публикация (`tasks.publish_at`)

`tasks.publish_at` (nullable `TIMESTAMPTZ`) lets an admin schedule a task to appear on its
own, at a chosen moment, without sitting there to press a button. NULL — published
immediately (every historical row, and the default for the old `POST /api/tasks` flow).
Otherwise hidden from non-admins until `now() >= publish_at` — evaluated **lazily on every
read**, the same pattern as Междумирье's 5-day grace period ([LIMBO.md](LIMBO.md)): no
scheduler, no cron, no background tick exists in this project on purpose.

`services/tasks.py::published_where()` (SQL `WHERE`) / `is_published()` (scalar check) are
the single source of truth, applied everywhere a task's visibility is decided for a
non-admin: `_visible_common_where` (covers `list_tasks`, `compute_progress`,
`attention_count`, `overdue_tasks_for`), `assert_task_visible` (covers task detail,
submissions, review — 404, not 403: an unpublished task reads as "doesn't exist yet", the
same semantics `load_task` already uses for a deleted one, not "you lack access"), the
`my_individual` branch of `list_tasks` (individual/pair/stream, which `_visible_common_where`
doesn't cover), the calendar's `visible_task_ids` filter ([CALENDAR.md](CALENDAR.md) — a
scheduled task's deadline doesn't leak onto the calendar early), and task-media access
(`services/media.py::_visible_task` — gates both the task's own condition media and
submission media by the same rule, so a scheduled task's attachments can't be probed by
asset id before the task itself is visible). `create_task`/`update_task` also skip the
`task.created`/`task.updated` WS fan-out while the task is still scheduled — there is no
one to notify yet.

Admin sees a scheduled task always (list, detail, media), marked in the UI so it reads as
"будет опубликовано", not as a bug.

## База заданий и переиздание (админский хаб `/admin/tasks`)

**«База заданий»** (`features/admin/AdminTasks.tsx`, `GET /api/admin/tasks`) is a second
admin entry point into tasks — every non-deleted task across **all** intakes in one list
(filterable by intake/type/title search), except cross-tasks (`pair_id IS NOT NULL` —
those are what participants hand each other inside a pair, not admin-authored material).
Same relationship to `/tasks` as «Проверка» (ARG-134) has to per-task review: a second view
over the same data, not a replacement. Ordinary task creation still works both here and on
`/tasks` — the hub adds two things `/tasks` doesn't have: **republishing** a task for
another intake, and scheduling any task's publication (previous section).

**Переиздание = clone, not move.** `POST /api/admin/tasks/{task_id}/republish`
(`services/tasks.py::clone_task`) copies title, body, `kb_item_id`, `sets_display_name`,
`task_media` rows (same `media_asset_id` — no re-upload, media access is gated by the task,
not by asset ownership) and, unless the caller overrides them, `task_plans`, into a **brand
new** `tasks` row with the target `intake_id`. It always creates a `common` task, regardless
of the source's type — a republish doesn't carry over the source's specific recipients (a
`common` task never had named recipients to carry; `individual`/`pair`/`stream` sources are
rejected with 400, see below). The clone gets **zero** `task_assignments` /
`task_submissions` / `task_comments` — that's the entire point: a participant who already
submitted (and was accepted for) the original task in a past intake gets a completely fresh
`assigned` status on the clone, because there is no assignment row linking them to it yet.
The original task, and its full submission history, is untouched — an unrelated archive row
from that point on.

`source_task_id` (self-FK on `tasks`) marks the clone's root: the original if it's not
itself a clone, otherwise whatever root it points to. `services/tasks.py::
family_published_intake_ids` walks a set of roots to the full list of intakes their
"family" (root + every clone) has already been published to — the hub disables those
intakes in the republish picker, and `republish` itself 409s on a repeat for the same
intake, so a task can't accidentally be republished twice onto one cohort.

**Only `common`/`individual` sources may be republished** (400 otherwise). `pair`/`stream`
tasks build their grid/pairs from a concrete, hand-picked set of participants — there is no
sensible way to "republish" that onto a different intake's roster automatically. Instead the
hub offers **«Создать на основе»**: the ordinary create form (`TaskForm`, `createFromInitial`
prop) pre-filled with the source's title/body/media/deadline/tariffs, but type and
recipients are picked fresh, same as any new task.

`RepublishRequest` accepts `intake_id` (required), `deadline_at`/`publish_at` (both
optional — the clone can be scheduled the same way as any task, previous section), and
`plan_ids` (omit to copy the source's tariffs as-is; `[]` explicitly lifts the tariff
restriction).

## Frontend note

Task create/edit (admin) and participant submission share `components/MediaComposer.tsx` (markdown textarea + upload-with-progress + pending chips). See [FRONTEND.md](FRONTEND.md).

Admin task actions live in two places now: quick same-intake create/edit/delete directly on
`features/tasks/TasksList.tsx` (`/tasks`, gated by `user?.role === 'admin'`), and the
cross-intake hub `features/admin/AdminTasks.tsx` (`/admin/tasks`, section «Задания», group
«Прохождение») for browsing every intake's tasks, republishing onto another intake, and
scheduling `publish_at`. Both share the same `features/tasks/TaskForm.tsx` component (create/
edit/«Создать на основе») and the same mutation hooks in `api/tasks.ts`
(`useCreateTask`/`useUpdateTask`/`useDeleteTask` invalidate both screens' query keys).
`TaskForm`'s `initial` prop takes the minimal `TaskFormInitial` shape (not the full
`TaskWithStatusOut`) so a `TaskLibraryItemOut` row from the hub satisfies it too. Delete is
two-step via the shared `components/ConfirmDialog.tsx` instead of `window.confirm`;
edit/delete/republish are reached through a per-row `components/KebabMenu.tsx` (visible to
admins only). The old standalone «Прогресс» panel (per-assignment status list) was dropped
from `/tasks` — it duplicated information already visible via assignee chips on the card and
inside `TaskDetail`.

The admin list has two nested tab levels built on `components/Segmented.tsx`: **Активные /
Истёк срок** (by `deadline_at` vs now) at the top, and **Общие / Индивидуальные / Парные и
потоки / Перекрёстные** underneath (перекрёстные = `pair_id != null`, checked before type).
On the «Общие» tab only, a tariff filter (checkboxes over `useAdminPlans()`, all checked by
default) narrows the list client-side: a task with empty `plan_ids` (no restriction) always
shows; a task restricted to specific plans shows only while at least one of its `plan_ids`
is checked. This is purely a display filter — it does not affect what the backend returns
or what `plan_visibility_clause` enforces server-side (ARG-96).

Recipient pickers in `TaskForm.tsx` (individual / pair / stream) read `GET /api/admin/users`,
not the public `GET /api/users`: the list is scoped to the **active intake** (latest `starts_on`)
by default, with a «Набор получателей» selector to switch to another intake or «Все наборы».
Server-side task creation is unchanged — the filter only narrows what the admin sees.

**Returned status is not an alarm.** `Chip kind="returned"` used to be blood-red
everywhere (`/tasks` card, `TaskDetail` head/status chips, the dashboard widget) — a task
sent back for another pass isn't a failure, so it now renders in the neutral `--stone`
family (a token that wasn't claimed by anything else), same as `--blood`/`--color-more`
are reserved for danger/attention elsewhere.

When *your own* track is `returned`, `TaskDetail.tsx` shows a `ReturnedFeedback` panel
right next to the resubmission form — reviewer's comment on top (the whole point of
coming back to the task), your previous submission collapsed under a `<details>` below
it (still one click away, not re-litigated in full). That track is then excluded from the
`TracksSection` list further down the page so the same submission+comment thread doesn't
render twice; the section itself is skipped entirely for a participant if that was the
only thing in it. Admins/cross-authors (`canReview`) are unaffected — they still see every
track in the flat list, review actions and all.
