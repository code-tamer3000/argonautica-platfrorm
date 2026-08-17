// Клиентский сбор метрик производительности (измерительный слой). Два раздела,
// одна механика очереди: метрики медиа (ниже) и клиентский RUM (в конце файла —
// первый экран, открытие комнаты, кэш медиа, упавшие экраны).
//
// Зачем: «с телефона долго грузит фото/видео и долго отправляет». Меряем РЕАЛЬНЫЕ
// шаги с устройства пользователя (его сеть), чтобы понять, где теряется время:
// presign → PUT в MinIO → confirm (upload); presign → загрузка байтов (download).
//
// Трейсы копим и шлём пачкой на POST /api/metrics/media — реже round-trip'ов, не
// мешаем UX. Отправка best-effort: сбой сбора НИКОГДА не влияет на само сообщение.
// `keepalive` даёт долететь пачке даже при уходе со страницы.
import { getAccessToken } from './tokens'

export type MetricOp = 'upload' | 'download'
export type MetricKind = 'image' | 'video' | 'file' | 'audio'

interface MediaMetric {
  op: MetricOp
  kind: MetricKind
  size?: number
  net?: string
  total_ms: number
  steps: Record<string, number>
}

const MEDIA_ENDPOINT = '/api/metrics/media'
const CLIENT_ENDPOINT = '/api/metrics/client'
const FLUSH_INTERVAL_MS = 10_000
const MAX_BATCH = 50

/** Тип сети из Network Information API (4g/3g/wifi/…), если браузер его отдаёт. */
function networkType(): string | undefined {
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection
  return conn?.effectiveType
}

/**
 * Очередь отправки на один приёмник: копим, шлём пачкой, дожимаем `keepalive`.
 * Одна и та же механика на оба вида метрик (медиа и клиентский RUM) — формат
 * тела (`{items}`) у них общий, различается только адрес.
 */
function createSender<T>(endpoint: string) {
  let queue: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule(): void {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, FLUSH_INTERVAL_MS)
  }

  async function flush(): Promise<void> {
    if (queue.length === 0) return
    const items = queue.slice(0, MAX_BATCH)
    queue = queue.slice(MAX_BATCH)
    const token = getAccessToken()
    if (!token) return // не залогинен — метрики отбрасываем, не копим бесконечно
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items }),
        keepalive: true, // долетит даже если вкладку закрывают
      })
    } catch {
      // Сеть отвалилась — метрики не критичны, роняем эту пачку молча.
    }
    if (queue.length > 0) schedule()
  }

  function report(item: T): void {
    try {
      queue.push(item)
      if (queue.length >= MAX_BATCH) void flush()
      else schedule()
    } catch {
      // no-op: сбор метрик не должен ломать вызывающий код
    }
  }

  return { report, flush }
}

const mediaSender = createSender<MediaMetric>(MEDIA_ENDPOINT)
const clientSender = createSender<ClientMetric>(CLIENT_ENDPOINT)

/** Отправить накопленные трейсы (best-effort). Вызывается по таймеру и на pagehide. */
export async function flushMetrics(): Promise<void> {
  await Promise.all([mediaSender.flush(), clientSender.flush()])
}

/** Поставить трейс медиа в очередь на отправку. Никогда не бросает. */
export function reportMetric(metric: MediaMetric): void {
  mediaSender.report(metric)
}

// Дослать хвост очереди, когда страницу сворачивают/закрывают (мобилки часто
// выгружают вкладку в фон) — иначе последние трейсы (самые интересные, если юзер
// ушёл из-за долгой загрузки) потеряются.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushMetrics()
  })
  window.addEventListener('pagehide', () => void flushMetrics())
}

/**
 * Секундомер по шагам одной медиа-операции. Использование:
 *
 *   const tr = new MediaTracer('upload', kind, size)
 *   tr.step('presign', async () => http.post(...))   // засечёт длительность
 *   tr.done()                                          // поставит total и отправит
 *
 * `mark`/`measure` — ручной вариант, когда шаг не оборачивается в один await
 * (напр. время до onload картинки в другом колбэке).
 */
export class MediaTracer {
  private steps: Record<string, number> = {}
  private started = performance.now()

  constructor(
    private op: MetricOp,
    private kind: MetricKind,
    private size?: number,
  ) {}

  /** Обернуть async-шаг: замерить его длительность под именем `name`. */
  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now()
    try {
      return await fn()
    } finally {
      this.steps[`${name}_ms`] = performance.now() - t0
    }
  }

  /** Записать уже измеренную длительность шага (мс) вручную. */
  record(name: string, ms: number): void {
    this.steps[`${name}_ms`] = ms
  }

  /** Метка «сейчас» относительно старта трейса — для ручного measure. */
  mark(): number {
    return performance.now()
  }

  /** Завершить трейс: total = время с начала, поставить в очередь отправки. */
  done(extraSteps?: Record<string, number>): void {
    const total = performance.now() - this.started
    const steps = { ...this.steps }
    if (extraSteps) for (const [k, v] of Object.entries(extraSteps)) steps[`${k}_ms`] = v
    reportMetric({
      op: this.op,
      kind: this.kind,
      size: this.size,
      net: networkType(),
      total_ms: total,
      steps,
    })
  }
}

// ─────────────────────────── Клиентский RUM ───────────────────────────
//
// Меряем то, чего не видно с сервера (docs/FRONTEND.md «Клиентский RUM»):
//  * загрузку приложения — Navigation Timing + LCP. Разделитель, ради которого всё
//    затевалось: `ttfb` = канал плюс сервер, `lcp − ttfb` = фронт;
//  * открытие комнаты — запрос истории → первый байт → отрисовка списка;
//  * сумму скачанных байт медиа за заход в комнату (первый против повторного) —
//    так видно, попадает ли браузерный кэш медиа или сломался молча;
//  * упавший экран — необработанная ошибка и `unhandledrejection`.
//
// Всё best-effort: недоступный приёмник или отсутствующий API браузера не должны
// ронять ни один экран, поэтому здесь везде try/catch и мягкие деградации.

declare const __BUILD_VERSION__: string | undefined

/** Версия сборки фронта: без неё цифры до и после релиза смешиваются в кашу. */
export const BUILD_VERSION: string =
  typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev'

type ClientMetricKind = 'navigation' | 'room_open' | 'resources' | 'error'

interface ClientMetric {
  kind: ClientMetricKind
  build: string
  net?: string
  cold?: boolean
  route?: string
  visit?: 'first' | 'repeat'
  total_ms?: number
  steps?: Record<string, number>
  bytes?: Record<string, number>
  message?: string
  stack?: string
}

// Сколько ждём после загрузки, прежде чем отправить трейс первого экрана: LCP
// уточняется по мере отрисовки, а уходить раньше — значит мерить не первый экран.
const NAV_SETTLE_MS = 5_000
// Сколько ждём после отрисовки комнаты, прежде чем считать скачанные байты: медиа
// подтягивается лениво, сразу после рендера сумма была бы почти нулевой всегда.
const RESOURCE_SETTLE_MS = 3_000
// На сколько отматываем начало окна замера назад (см. sampleRoomResources).
const RESOURCE_LOOKBACK_MS = 1_000
// Потолок ошибок за сессию: упавший рендер умеет сыпать в цикле, приёмник не должен
// стать вторым источником проблем.
const MAX_ERRORS_PER_SESSION = 10
const VISITED_ROOMS_KEY = 'arg:rum:rooms'

/** Роут SPA без query и хэша: там могли бы оказаться пользовательские данные. */
function currentRoute(): string {
  try {
    return location.pathname
  } catch {
    return '/'
  }
}

/** Холодный заход — service worker ещё не управляет страницей (кэш оболочки пуст). */
function isColdStart(): boolean | undefined {
  try {
    if (!('serviceWorker' in navigator)) return undefined
    return navigator.serviceWorker.controller === null
  } catch {
    return undefined
  }
}

/** Поставить клиентское событие в очередь. Никогда не бросает. */
export function reportClientMetric(metric: Omit<ClientMetric, 'build'>): void {
  clientSender.report({ ...metric, build: BUILD_VERSION })
}

// ── Загрузка приложения ──────────────────────────────────────────────

let navReported = false
let largestContentfulPaint = 0

function collectNavigationTrace(): void {
  if (navReported) return
  navReported = true
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (!nav) return
    const steps: Record<string, number> = {}
    const add = (name: string, ms: number): void => {
      if (Number.isFinite(ms) && ms > 0) steps[name] = ms
    }
    add('dns', nav.domainLookupEnd - nav.domainLookupStart)
    add('tcp', nav.connectEnd - nav.connectStart)
    if (nav.secureConnectionStart > 0) add('tls', nav.connectEnd - nav.secureConnectionStart)
    add('ttfb', nav.responseStart - nav.startTime)
    add('dom_interactive', nav.domInteractive - nav.startTime)
    // LCP может не поддерживаться браузером — тогда трейс уходит без него, а не теряется.
    add('lcp', largestContentfulPaint)
    if (Object.keys(steps).length === 0) return
    reportClientMetric({
      kind: 'navigation',
      net: networkType(),
      cold: isColdStart(),
      route: currentRoute(),
      steps,
    })
  } catch {
    // no-op: измерение не важнее приложения
  }
}

function observeLcp(): void {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        largestContentfulPaint = Math.max(largestContentfulPaint, entry.startTime)
      }
    })
    observer.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    // Браузер не отдаёт LCP — остальные поля трейса всё равно уходят.
  }
}

// ── Упавший экран ────────────────────────────────────────────────────

let errorsReported = 0

/** Записать необработанную ошибку: сообщение, стек, роут, версия сборки. */
function reportClientError(message: string, stack?: string): void {
  if (errorsReported >= MAX_ERRORS_PER_SESSION) return
  errorsReported += 1
  reportClientMetric({
    kind: 'error',
    route: currentRoute(),
    net: networkType(),
    // Режем длину: в лог должно попасть «что сломалось», а не простыня.
    message: String(message).slice(0, 500),
    stack: stack ? stack.slice(0, 4000) : undefined,
  })
  // Экран мог упасть совсем — не ждём таймера, дожимаем сразу.
  void flushMetrics()
}

// ── Открытие комнаты ─────────────────────────────────────────────────

interface RoomOpenTrace {
  started: number
  requestMs?: number
  ttfbMs?: number
}

const roomTraces = new Map<number, RoomOpenTrace>()
// Трейс, не дошедший до отрисовки (юзер ушёл, запрос упал), не должен висеть вечно.
const ROOM_TRACE_TTL_MS = 60_000

/** Начало открытия комнаты: вызывается перед запросом первой страницы истории. */
export function beginRoomOpen(roomId: number): void {
  try {
    const now = performance.now()
    for (const [id, trace] of roomTraces) {
      if (now - trace.started > ROOM_TRACE_TTL_MS) roomTraces.delete(id)
    }
    roomTraces.set(roomId, { started: now })
  } catch {
    // no-op
  }
}

/** История комнаты пришла: длительность запроса целиком и время до первого байта. */
export function noteRoomHistoryLoaded(roomId: number, path: string): void {
  try {
    const trace = roomTraces.get(roomId)
    if (!trace) return
    trace.requestMs = performance.now() - trace.started
    // Первый байт берём из Resource Timing запроса истории: fetch отдаёт управление
    // только после разбора тела, сам по себе он первый байт не показывает.
    const url = new URL(path, location.origin).href
    const entries = performance.getEntriesByName(url) as PerformanceResourceTiming[]
    const last = entries[entries.length - 1]
    if (last && last.responseStart > 0 && last.requestStart > 0) {
      trace.ttfbMs = last.responseStart - last.requestStart
    }
  } catch {
    // no-op
  }
}

/** Список сообщений отрисован — трейс открытия комнаты закрывается и уходит. */
export function noteRoomRendered(roomId: number): void {
  try {
    const trace = roomTraces.get(roomId)
    // Без запроса истории (лента пришла из кэша) сценарий не измеряем: там нет
    // ни запроса, ни первого байта — цифра была бы не про то.
    if (!trace || trace.requestMs === undefined) return
    roomTraces.delete(roomId)
    const steps: Record<string, number> = { request_ms: trace.requestMs }
    if (trace.ttfbMs !== undefined) steps.ttfb_ms = trace.ttfbMs
    const total = performance.now() - trace.started
    steps.render_ms = Math.max(0, total - trace.requestMs)
    reportClientMetric({
      kind: 'room_open',
      net: networkType(),
      route: currentRoute(),
      total_ms: total,
      steps,
    })
  } catch {
    // no-op
  }
}

// ── Скачанные байты медиа за заход в комнату ──────────────────────────

/** Отметить заход в комнату: первый в этой сессии или повторный. */
function markRoomVisit(roomId: number): 'first' | 'repeat' {
  try {
    const raw = sessionStorage.getItem(VISITED_ROOMS_KEY)
    const visited = new Set<number>(raw ? (JSON.parse(raw) as number[]) : [])
    const visit = visited.has(roomId) ? 'repeat' : 'first'
    visited.add(roomId)
    sessionStorage.setItem(VISITED_ROOMS_KEY, JSON.stringify([...visited].slice(-100)))
    return visit
  } catch {
    return 'first'
  }
}

const IMAGE_RE = /\.(webp|jpe?g|png|gif|avif|bmp|heic|heif)(\?|$)/i
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|oga|wav|weba)(\?|$)/i

/** Тип медиа-ресурса; не-медиа (скрипты, стили, API) в счёт не идут. */
function mediaKind(entry: PerformanceResourceTiming): 'image' | 'video' | 'audio' | null {
  const type = entry.initiatorType
  if (type === 'img') return 'image'
  if (type === 'video') return 'video'
  if (type === 'audio') return 'audio'
  const name = entry.name
  if (IMAGE_RE.test(name)) return 'image'
  if (VIDEO_RE.test(name)) return 'video'
  if (AUDIO_RE.test(name)) return 'audio'
  return null
}

/**
 * Посчитать байты медиа, скачанные за заход в комнату, и отправить их.
 * Возвращает функцию отмены (комнату закрыли раньше, чем истёк замер).
 *
 * `transferSize === 0` у отданного из кэша ответа — именно поэтому сумма на
 * повторном заходе и должна проседать почти до нуля, если кэш работает.
 */
export function sampleRoomResources(roomId: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    // Отсчитываем чуть раньше момента вызова: при заходе с перезагрузкой страницы
    // лента рисуется из восстановленного кэша сразу на монтировании, и картинки
    // успевают уйти в сеть буквально в том же кадре, что и этот замер. Секунда
    // назад — компромисс: свои картинки не теряем, чужие (прошлой комнаты) не берём.
    const since = Math.max(0, performance.now() - RESOURCE_LOOKBACK_MS)
    const visit = markRoomVisit(roomId)
    timer = setTimeout(() => {
      try {
        const bytes: Record<string, number> = {}
        const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
        for (const entry of entries) {
          if (entry.startTime < since) continue
          const kind = mediaKind(entry)
          if (!kind) continue
          bytes[kind] = (bytes[kind] ?? 0) + (entry.transferSize || 0)
        }
        if (Object.keys(bytes).length === 0) return
        reportClientMetric({
          kind: 'resources',
          visit,
          net: networkType(),
          route: currentRoute(),
          bytes,
        })
      } catch {
        // no-op
      }
    }, RESOURCE_SETTLE_MS)
  } catch {
    // no-op
  }
  return () => {
    if (timer !== null) clearTimeout(timer)
  }
}

// ── Включение сбора ──────────────────────────────────────────────────

let rumStarted = false

/**
 * Включить клиентский RUM: LCP-обсервер, трейс первого экрана, перехват ошибок.
 * Вызывается один раз на старте приложения; повторный вызов — no-op.
 */
export function initClientRum(): void {
  if (rumStarted || typeof window === 'undefined') return
  rumStarted = true
  try {
    observeLcp()

    // Трейс первого экрана уходит, когда LCP уже устоялся, — или раньше, если
    // вкладку сворачивают (иначе самый интересный случай «ушёл, не дождавшись»
    // потерялся бы).
    const finish = (): void => collectNavigationTrace()
    if (document.readyState === 'complete') setTimeout(finish, NAV_SETTLE_MS)
    else window.addEventListener('load', () => setTimeout(finish, NAV_SETTLE_MS), { once: true })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finish()
    })

    window.addEventListener('error', (event) => {
      reportClientError(event.message || 'script error', event.error?.stack)
    })
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason as { message?: string; stack?: string } | string | undefined
      const message =
        typeof reason === 'string' ? reason : (reason?.message ?? 'unhandled rejection')
      reportClientError(message, typeof reason === 'object' ? reason?.stack : undefined)
    })
  } catch {
    // no-op: сбор метрик не имеет права ломать старт приложения
  }
}
