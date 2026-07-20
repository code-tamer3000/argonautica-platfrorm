# Tasks (раздел «Задачи»)

> Source: backend/app/{models/task.py, api/tasks.py, services/tasks.py} + docs/archive/PROGRESS.md st.22, restructured 2026-07-06.
> Endpoints: `/api/tasks`. Tables: `tasks`, `task_media`, `task_assignments`, `task_submissions`, `task_submission_media`, `task_comments` (see [DATA_MODEL.md](DATA_MODEL.md)).

Author assigns work; participants submit; admin reviews. A task is **common** (`type='common'` — visible to every active participant, anyone may submit), **individual** (`type='individual'` — addressed to specific users via `task_assignments`), or **pair** (`type='pair'` — peer-learning; see "Pair tasks" below).

> **Observers** (`users.is_observer`, see [AUTH.md](AUTH.md)) have no access to Задачи at all: the whole `/api/tasks` router is behind `require_participant` → 403.

## Assignments & lifecycle

- Individual tasks → `task_assignments` rows created at task creation. Common tasks → rows created **lazily on first submission** (implicit access, like channels).
- `task_assignments.status`: `assigned → submitted → returned → accepted`. `late` is set on the first submission after `deadline_at`.
- Submission history is kept (a return produces a new `task_submissions` row; the latest is the current one).

## Media

- **Prompt media** (`task_media`) — attached by admin to the task itself; mirror of `task_submission_media` (submission attachments). Both go through the shared `media_assets` / presigned flow (see [FILES.md](FILES.md)).
- `create_task` / `update_task` accept `media_asset_ids` → saved into `task_media`. `get_task` / `list_tasks` return `attachments` batch-signed via `resolve_task_attachments`.
- **Media access**: `assert_media_access` gates task media by task visibility — `common` → any participant; `individual` → assignee / admin.

## Review

- Admin review changes assignment status; a return writes a `task_comments` row (feedback) on the latest submission. Comments are soft-deleted.

## Attention badge

- `attention_count` (in `list_tasks`, feeds the «Задачи» nav badge) = user's assignments not yet `accepted` (`assigned`/`submitted`/`returned`, common & individual) **plus** untouched common tasks (no assignment row yet). Accepting a task decrements it; when everything is accepted it is 0. A freshly assigned individual task increments it immediately. See `attention_count` in `services/tasks.py`.

## Progress counts (per task row)

`list_tasks` / `get_task` return per-task aggregates so the admin sees progress on the «Задачи» section itself (no need to open the management panel):

- `submitted_count` — assignments in `submitted`/`returned`/`accepted` (i.e. "сдали"); `accepted_count` — `accepted`; `unreviewed_count` — `submitted` only (awaiting review).
- `total_recipients` — the "из скольки" denominator: **individual** → assignee count; **common** → active participant count (`participant_count` in `services/tasks.py`), since common assignment rows are created lazily.
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
  не делает, в комнату подгруппы `assert_room_access` тоже не пустит). В `build_stream_out`
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

## Frontend note

Task create/edit (admin) and participant submission share `components/MediaComposer.tsx` (markdown textarea + upload-with-progress + pending chips). See [FRONTEND.md](FRONTEND.md).
