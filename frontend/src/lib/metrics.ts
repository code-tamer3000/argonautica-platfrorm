// Клиентский сбор метрик производительности медиа (измерительный слой).
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

const ENDPOINT = '/api/metrics/media'
const FLUSH_INTERVAL_MS = 10_000
const MAX_BATCH = 50

let queue: MediaMetric[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Тип сети из Network Information API (4g/3g/wifi/…), если браузер его отдаёт. */
function networkType(): string | undefined {
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection
  return conn?.effectiveType
}

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushMetrics()
  }, FLUSH_INTERVAL_MS)
}

/** Отправить накопленные трейсы (best-effort). Вызывается по таймеру и на pagehide. */
export async function flushMetrics(): Promise<void> {
  if (queue.length === 0) return
  const items = queue.slice(0, MAX_BATCH)
  queue = queue.slice(MAX_BATCH)
  const token = getAccessToken()
  if (!token) return // не залогинен — метрики отбрасываем, не копим бесконечно
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items }),
      keepalive: true, // долетит даже если вкладку закрывают
    })
  } catch {
    // Сеть отвалилась — метрики не критичны, роняем эту пачку молча.
  }
  if (queue.length > 0) scheduleFlush()
}

/** Поставить трейс в очередь на отправку. Никогда не бросает. */
export function reportMetric(metric: MediaMetric): void {
  try {
    queue.push(metric)
    if (queue.length >= MAX_BATCH) void flushMetrics()
    else scheduleFlush()
  } catch {
    // no-op: сбор метрик не должен ломать вызывающий код
  }
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
