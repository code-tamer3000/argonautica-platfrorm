// Типы из контракта бэкенда (поля = ответы API). Держать в синхроне с backend/app/schemas.

export type Role = 'participant' | 'admin'
export type RoomType = 'dm' | 'group' | 'channel'
export type RoomRole = 'owner' | 'member'
export type MediaKind = 'image' | 'video' | 'file' | 'audio'

// Ссылка-референс из сообщения на материал КБ или задачу.
export type RefKind = 'kb' | 'task'

export interface MessageRefOut {
  kind: RefKind
  id: number
  // Заголовок цели для зрителя; при available=false — заглушка «Недоступно».
  title: string
  // Относительный путь для перехода: /kb/:id или /tasks/:id.
  url: string
  // Есть ли у зрителя доступ к цели (иначе кнопка неактивна).
  available: boolean
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
}

export interface UserOut {
  id: number
  username: string
  email: string | null
  display_name: string
  avatar_url: string | null
  bio: string | null
  role: Role
  must_change_password: boolean
  can_create_groups: boolean
  can_access_cabin: boolean
  // Режим наблюдателя: пассивный доступ «только к материалам» (см. AppShell).
  is_observer: boolean
  // Навигатор (ARG-110): только у role='admin'.
  is_navigator: boolean
  // Ждём выпускную анкету — AuthGuard перекрывает платформу её экраном.
  survey_required: boolean
  // Экспедиция пройдена (анкета сдана): Динамика скрыта, в Задачах только сданное,
  // Рубка — только чтение. Ставится сервером один раз и не снимается.
  graduated_at: string | null
  settings: Record<string, unknown>
  // Набор участника (ARG-106): дата старта — гейт Рубки/Календаря; текст — поп-ап
  // при первом входе. Оба null у бесхозного участника или у набора без текста.
  intake_starts_on: string | null
  intake_welcome_message: string | null
}

export interface PublicUserOut {
  id: number
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  role: Role
  // Тариф (ARG-110) — денормализован для группировки контакт-листа по секциям.
  plan_id: number | null
  plan_name: string | null
}

// «Аргонавты» (ростер потока + профиль участника) — состав фильтруется на
// сервере (свой intake, без наблюдателей/админов), задачи — только видимые
// смотрящему common-задачи (двойной фильтр поток+тариф, как в разделе «Задачи»).
export interface ArgonautOut {
  id: number
  username: string
  display_name: string
  avatar_url: string | null
  role: Role
  plan_id: number | null
  plan_name: string | null
  tasks_done: number
}

export type ArgonautTaskStatus = 'accepted' | 'submitted'

export interface ArgonautTaskOut {
  task_id: number
  title: string
  status: ArgonautTaskStatus
  deadline_at: string | null
  reviewed_at: string | null
}

export interface ArgonautDetailOut {
  id: number
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  role: Role
  plan_id: number | null
  plan_name: string | null
  tasks_done: number
  diary_room_id: number | null
  tasks: ArgonautTaskOut[]
}

export interface RoomOut {
  id: number
  type: RoomType
  name: string | null
  avatar_url: string | null
  created_at: string
  unread_count: number
  is_personal: boolean
  is_news: boolean
  created_by: number
  peer_id?: number
  // Комната подгруппы потока: над композером висит голосование за общую фразу.
  stream_node_id?: number | null
  stream_task_id?: number | null
  // Только channel: изоляция по потоку/тарифу (ARG-96).
  intake_id?: number | null
  plan_ids?: number[]
  // Только is_personal: тариф владельца дневника (группировка «Все дневники»).
  owner_plan_id?: number | null
  owner_plan_name?: string | null
  // Только dm: односторонний запрет ответа админу без is_navigator (ARG-110) —
  // прячем композер, сервер 403-ит тот же путь независимо от этого поля.
  dm_write_locked?: boolean
}

export interface MemberOut {
  room_id: number
  user_id: number
  role_in_room: RoomRole
  joined_at: string
}

export interface MessageOut {
  id: number
  room_id: number
  sender_id: number
  content: string | null
  sticker_id: number | null
  thread_root_id: number | null
  forwarded_from_sender_id: number | null
  reply_count: number
  // Непрочитанные ответы в треде этого корня (ответы с id > нашего last_read).
  // Задаётся только для корней ленты; иначе 0. Оптимистичные (outbox) — 0.
  unread_reply_count: number
  last_reply_at: string | null
  created_at: string
  edited_at: string | null
  attachment_ids: number[]
  // Вложения с готовыми presigned-URL и превью — приходят прямо в ленте, без
  // отдельного запроса на каждый ассет. Пусто у старых сообщений в кэше.
  attachments: AttachmentOut[]
  // Ссылка на материал КБ / задачу (одна на сообщение). null = ссылки нет.
  // title/available резолвит сервер для текущего зрителя.
  ref?: MessageRefOut | null
  // Реакция (MVP: один фиксированный образ). reacted_by_me — для текущего зрителя.
  reaction_count: number
  reacted_by_me: boolean
  // --- клиентские поля (только для оптимистичных сообщений из outbox) ---
  // Присутствует лишь у ещё не подтверждённых сервером сообщений: id при этом
  // отрицательный (временный), а _outbox описывает статус доставки. У реальных
  // сообщений с сервера этих полей нет.
  _outbox?: OutboxDelivery
}

// Статус доставки оптимистичного сообщения (см. lib/outbox.ts).
//   'pending' — в очереди/отправляется, ждём ответа сервера
//   'failed'  — сеть недоступна или сервер вернул ошибку; ждём повтора/ручного действия
export interface OutboxDelivery {
  clientId: string
  status: 'pending' | 'failed'
  // Доля 0..1 заливки вложений в MinIO, пока сообщение ещё pending. undefined —
  // заливки нет/не началась (текстовое сообщение, или байты ещё не пошли). Показывается
  // как полоса на оптимистичном пузыре; на реальном сообщении с сервера поля нет.
  uploadProgress?: number
}

export interface AttachmentOut {
  asset_id: number
  // Отдаваемый объект: у видео — транскод-вариант (если готов), иначе оригинал.
  url: string
  thumb_url: string | null
  // Промежуточный дериват картинки (WebP ~1600px) для лайтбокса: оригинал в 11 МБ
  // на телефоне открывать незачем. null — легаси-запись, не картинка, либо генерация
  // не удалась; тогда лайтбокс откатывается на `url`. Скачивание всегда берёт `url`.
  preview_url?: string | null
  kind: MediaKind
  mime_type: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  // Состояние серверного транскода видео. null у не-видео и у легаси-видео (до фичи —
  // играем как раньше по url). 'processing' — вариант готовится (спиннер + постер);
  // 'done' — url ведёт на вариант; 'failed' — вариант не собрался, url = оригинал.
  transcode_status?: 'processing' | 'done' | 'failed' | null
}

export interface ThreadOut {
  root: MessageOut
  replies: MessageOut[]
}

export interface PinnedOut {
  room_id: number
  message_id: number
  pinned_by: number
  pinned_at: string
  message: MessageOut
}

export interface ReadStateOut {
  room_id: number
  last_read_message_id: number | null
  unread_count: number
}

export interface UploadTicket {
  upload_url: string
  bucket: string
  storage_key: string
  expires_in: number
}

export interface MediaAssetOut {
  id: number
  bucket: string
  storage_key: string
  kind: MediaKind
  mime_type: string
  size: number
  width: number | null
  height: number | null
  duration: number | null
  created_at: string
}

export interface MediaUrlOut {
  url: string
  expires_in: number
  kind: MediaKind
  duration: number | null
  width: number | null
  height: number | null
  thumb_url: string | null
  // См. AttachmentOut.preview_url.
  preview_url?: string | null
  transcode_status?: 'processing' | 'done' | 'failed' | null
}

export interface ServerMetricsOut {
  ts: number
  uptime_seconds: number
  cpu_percent: number | null
  load_avg: [number, number, number] | null
  mem: { total: number; used: number } | null
  net: { tx_bytes_sec: number; rx_bytes_sec: number }
  ws_connections: number
  redis: { connected_clients: number | null; used_memory: number | null }
  db_pool: { size: number | null; checked_out: number | null }
}

export interface KbCategoryOut {
  id: number
  title: string
  sort_order: number
}

export interface KbItemOut {
  id: number
  category_id: number | null
  title: string
  body: string | null
  published: boolean
  created_by: number
  sort_order: number
  created_at: string
  updated_at: string
  media_asset_ids: number[]
  // Изоляция по потоку/тарифу (ARG-96): null/пусто = доступен всем потокам/тарифам.
  intake_id: number | null
  plan_ids: number[]
}

export interface KbCommentOut {
  id: number
  kb_item_id: number
  author_id: number
  body: string
  created_at: string
}

export interface CalendarEventOut {
  id: number
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  // Заполнено = автоуправляемое дедлайн-событие задачи.
  task_id: number | null
  created_by: number
  created_at: string
  // Изоляция по потоку/тарифу (ARG-96/ARG-111): null/пусто = видно всем потокам/тарифам.
  intake_id: number | null
  plan_ids: number[]
  // Обогащение дедлайн-событий задачи (только при task_id):
  // выполнил ли задачу текущий юзер (для участника).
  task_done: boolean
  // Прогресс проверки для админа (сдали / всего адресатов); у участника — null.
  task_submitted_count: number | null
  task_total_count: number | null
}

export interface StickerOut {
  id: number
  pack_id: number
  image_url: string | null
  keyword: string | null
  sort_order: number
}

export interface StickerpackOut {
  id: number
  name: string
  created_by: number
  created_at: string
  stickers: StickerOut[]
}

export interface AdminCreateUserResponse {
  id: number
  username: string
  one_time_password: string
}

export interface AdminUserOut {
  id: number
  username: string
  display_name: string
  email: string | null
  role: Role
  can_create_groups: boolean
  can_access_cabin: boolean
  is_observer: boolean
  // Навигатор (ARG-110): только у role='admin' — доступен для лички любому
  // тарифу своего потока, минуя ранговое ограничение.
  is_navigator: boolean
  is_active: boolean
  graduated_at: string | null
  created_at: string
  intake_id: number | null
  /** Дата старта набора (YYYY-MM-DD) — приходит рядом с юзером для группировки. */
  intake_starts_on: string | null
  plan_id: number | null
  /** Имя тарифа — приходит рядом с юзером (тот же приём, что intake_starts_on). */
  plan_name: string | null
}

/** Тариф для обычного участника — `GET /api/plans` (только активные, id+name). */
export interface PlanPublicOut {
  id: number
  name: string
}

/** Набор (когорта): дата старта задаёт начало 28-дневного окна Динамики.
 * `ends_on` — дата закрытия окна: после неё Динамика становится read-only архивом (ARG-96). */
export interface IntakeOut {
  id: number
  starts_on: string
  ends_on: string
  created_at: string
  user_count: number
}

// --- Динамика (прогресс ДЗ) ---
export type DayStatus = 'closed' | 'credited' | 'missed' | 'pardoned' | 'today_open' | 'today_closed' | 'before_start' | 'upcoming'

export interface RecentDay {
  date: string
  status: DayStatus
}

export interface MyDynamicsOut {
  streak: number
  overdue_dates: string[]
  pardons_used: number
  pardons_remaining: number
  today_progress: string[]
  program_start: string
  // Окно набора закрыто (ARG-96): статистика заморожена, форма отправки/помилования скрыта.
  window_closed: boolean
}

export interface UserDynamicsOut {
  user_id: number
  display_name: string
  username: string
  avatar_url: string | null
  streak: number
  overdue_count: number
  pardons_used: number
  active_today: boolean
  journal_today: boolean
  recent_days: RecentDay[]
  /** Набор участника — по нему админский обзор группирует карточки. */
  intake_id: number | null
  // Экспедиция пройдена: строка заморожена на дне выпуска и помечена бейджем,
  // в сводных счётчиках такой участник не учитывается.
  graduated_at: string | null
}

export interface DynamicsSummary {
  total_participants: number
  active_today: number
  journal_today: number
  no_overdue: number
  avg_streak: number
}

export interface AdminDynamicsOut {
  summary: DynamicsSummary
  users: UserDynamicsOut[]
}

// --- Круг Экспедиции: расписание этапов потока + замки-гексаграммы ---
export type StageKind = 'balance' | 'air' | 'fire' | 'water' | 'earth' | 'final'
export type Element = 'air' | 'fire' | 'water' | 'earth'
export type LockState = 'locked' | 'unlockable' | 'entered' | 'revealed'

export interface StageIn {
  kind: StageKind
  air_date: string
  air_time: string | null
  task_id: number | null
}

// Этап + вычисленное место в круге (не хранится — см. app/services/expedition.py).
export interface StageSpanOut extends StageIn {
  day_from: number
  day_to: number
}

export interface LockOut {
  element: Element
  key_number: number
  hexagram: string
  created_at: string
  updated_at: string
}

export interface ExpeditionOut {
  total_days: number
  today: number | null // 1..total_days; null — до старта или после конца окна
  stages: StageSpanOut[]
  days: RecentDay[] // весь круг, не ±окно
  locks: Partial<Record<Element, LockOut>>
  lock_states: Record<Element, LockState>
}

export interface NewsPreviewOut {
  room_id: number
  author_name: string
  preview: string
  created_at: string
}

// --- Структура дневника (задания) ---

export type JournalInputType = 'text' | 'title'

export interface JournalSection {
  key: string
  emoji: string
  label: string
  heading: string
  placeholder: string
  input_type: JournalInputType
  position: number
}

// Активное на сегодня задание — для виджета и композера участника.
export interface JournalStructure {
  program_id: number | null
  starts_on: string | null
  title: string | null
  description: string | null
  sections: JournalSection[]
}

// Задание в админке (со своей датой старта).
export interface JournalProgram {
  id: number
  starts_on: string
  title: string | null
  description: string | null
  created_by: number | null
  sections: JournalSection[]
}

// --- Уведомления (колокольчик + всплывающие тосты) ---
export type NotificationKind = 'dm' | 'reply' | 'news' | 'mention' | 'cabin_granted' | 'admin'

export interface NotificationOut {
  id: number
  kind: NotificationKind
  // room_id пуст у уведомлений без комнаты (cabin_granted — открыт доступ к Каюте).
  room_id: number | null
  // Для системных уведомлений (cabin_granted/admin) actor/message пусты.
  message_id: number | null
  actor_id: number | null
  actor_name: string | null
  preview: string | null
  ref_date: string | null
  // Заголовок админ-рассылки (kind='admin'); у остальных видов null.
  title: string | null
  created_at: string
  read_at: string | null
}

export interface NotificationListOut {
  items: NotificationOut[]
  unread_count: number
}

// --- Поддержка: обращения (предложить улучшение / сообщить об ошибке) ---
export type FeedbackKind = 'improvement' | 'bug'

export interface FeedbackOut {
  id: number
  kind: FeedbackKind
  body: string
  user_id: number
  user_name: string | null
  created_at: string
  resolved_at: string | null
}

export interface FeedbackListOut {
  items: FeedbackOut[]
  unresolved_count: number
}

// --- Тарифы бота-воронки приёма (ARG-92) ---
export interface PlanOut {
  id: number
  name: string
  price: number
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// --- Веб-воронка приёма: CRM-дашборд (ARG-107, read-only) ---
export type ApplicationStatus =
  | 'awaiting_about'
  | 'submitted'
  | 'choosing_plan'
  | 'awaiting_offer'
  | 'awaiting_receipt'
  | 'payment_review'
  | 'confirmed'
  | 'expired'

export interface ApplicationOut {
  id: number
  tg_id: number
  tg_username: string | null
  tg_first_name: string | null
  tg_last_name: string | null
  display_name: string
  status: ApplicationStatus
  about: string | null
  plan_id: number | null
  plan_name: string | null
  plan_price: number | null
  has_receipt: boolean
  receipt_kind: string | null
  offer_version: string | null
  user_id: number | null
  created_at: string
  submitted_at: string | null
  accepted_at: string | null
  plan_chosen_at: string | null
  offer_accepted_at: string | null
  receipt_at: string | null
  confirmed_at: string | null
  expired_at: string | null
  updated_at: string
  /** Момент входа в текущую стадию — считает бэкенд, фронт даты не пересчитывает. */
  stage_since: string | null
  days_in_stage: number | null
}

export interface ApplicationFunnelOut {
  total: number
  by_status: Record<ApplicationStatus, number>
  items: ApplicationOut[]
}

// --- Поддержка: частые вопросы (FAQ) ---
export interface FaqItemOut {
  id: number
  question: string
  answer: string
  sort_order: number
  created_at: string
  updated_at: string
}

// --- Каюта: личная психологическая проработка ---
export type CabinKind = 'diary' | 'decatastrophize' | 'trigger'

// Поля формы каждого подраздела (лежат в data записи). Все текстовые —
// необязательные (можно заполнить частично), strength ограничен 0..10.
export interface DiaryData {
  kind: 'diary'
  date: string
  trigger: string
  thoughts: string
  emotion: string
  strength: number
  body: string
  reaction: string
  recovery: string
}
export interface TriggerData {
  kind: 'trigger'
  age: string
  trigger: string
  thoughts: string
  emotion: string
  strength: number
  body: string
  reaction: string
  pattern: string
}
export interface DecatastrophizeData {
  kind: 'decatastrophize'
  topic: string
  fear: string
  probability: string
  worst_best: string
  resources: string
  new_idea: string
}
export type CabinData = DiaryData | TriggerData | DecatastrophizeData

export interface CabinEntryOut {
  id: number
  kind: CabinKind
  data: CabinData
  created_at: string
  updated_at: string
  // Только у оптимистичных, ещё не подтверждённых сервером записей (id при этом
  // отрицательный, временный). У реальных записей с сервера этого поля нет.
  // См. lib/cabinOutbox.ts — аналог OutboxDelivery для сообщений чата.
  _outbox?: OutboxDelivery
}
export interface AdminCabinEntryOut extends CabinEntryOut {
  user_id: number
  display_name: string
  username: string
}
export interface AdminCabinUser {
  user_id: number
  display_name: string
  username: string
  total: number
}

// --- WebSocket события ---
export type WsEvent =
  | { type: 'message.new'; message: MessageOut }
  | { type: 'message.edited'; message: MessageOut }
  | { type: 'message.deleted'; room_id: number; message_id: number }
  | { type: 'pin.added'; room_id: number; message_id: number; pinned_by: number }
  | { type: 'pin.removed'; room_id: number; message_id: number }
  | { type: 'reaction.added'; room_id: number; message_id: number; user_id: number; count: number }
  | { type: 'reaction.removed'; room_id: number; message_id: number; user_id: number; count: number }
  | { type: 'read'; room_id: number; user_id: number; last_read_message_id: number | null }
  | { type: 'typing'; room_id: number; user_id: number }
  | { type: 'presence'; user_id: number; status: 'online' | 'offline' }
  | { type: 'notification.new'; notification: NotificationOut }
  | { type: 'notification.removed'; notification_id: number; was_unread: boolean }
  | { type: 'subscribed'; room_id: number }
  | { type: 'unsubscribed'; room_id: number }
  | { type: 'error'; detail: string; room_id?: number }
  | { type: 'pong' }
  // Транскод видео готов/провалился — свежее вложение приходит целиком, клиент меняет
  // его в сообщении по asset_id (processing → playable / failed). См. docs/MESSAGES.md.
  | {
      type: 'attachment.updated'
      room_id: number
      message_id: number
      attachment: AttachmentOut
    }
  // Сервер добавил юзера в новую комнату (комнаты узлов потока) — список комнат
  // надо перечитать, иначе она появится только после reconnect.
  | { type: 'room.created'; room_id: number }
  | { type: 'room.closed'; room_id: number }
  // --- Задачи (приходят по тому же per-user каналу, что и notification.new) ---
  | { type: 'task.created'; task_id: number }
  | { type: 'task.updated'; task_id: number }
  | { type: 'submission.new'; task_id: number }
  | { type: 'submission.status'; task_id: number; assignment_id: number; status: string }
  | { type: 'task.comment.new'; submission_id: number; task_id: number }
