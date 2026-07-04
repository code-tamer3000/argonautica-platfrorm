import { useEffect, useRef, useState } from 'react'
import { useServerMetrics } from '../../api/admin'
import { Spinner } from '../../components/Spinner'
import type { ServerMetricsOut } from '../../lib/types'
import styles from './admin.module.css'
import m from './metrics.module.css'

const HISTORY = 40 // сколько последних точек держим для спарклайнов (~80 c при опросе 2 c)

// ─── Форматирование ──────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} Б`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`
}

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} Б/с`
  if (bytesPerSec < 1024 ** 2) return `${(bytesPerSec / 1024).toFixed(0)} КБ/с`
  return `${(bytesPerSec / 1024 ** 2).toFixed(2)} МБ/с`
}

function fmtUptime(sec: number): string {
  const s = Math.floor(sec)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const mn = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d} д ${h} ч`
  if (h > 0) return `${h} ч ${mn} мин`
  return `${mn} мин`
}

// ─── Спарклайн ───────────────────────────────────────────────────────────────

function Sparkline({ points, max }: { points: number[]; max?: number }) {
  if (points.length < 2) return <svg className={m.spark} />
  const top = max ?? Math.max(...points, 1)
  const w = 100
  const h = 34
  const step = w / (HISTORY - 1)
  // Прибиваем ряд к правому краю: свежая точка всегда справа.
  const offset = w - (points.length - 1) * step
  const d = points
    .map((v, i) => {
      const x = offset + i * step
      const y = h - (Math.min(v, top) / top) * (h - 2) - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className={m.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ─── Карточка ────────────────────────────────────────────────────────────────

function Card({
  label,
  value,
  unit,
  sub,
  history,
  max,
}: {
  label: string
  value: string
  unit?: string
  sub?: string
  history?: number[]
  max?: number
}) {
  return (
    <div className={m.card}>
      <span className={m.cardLabel}>{label}</span>
      <span className={m.cardValue}>
        {value}
        {unit && <span className={m.cardUnit}>{unit}</span>}
      </span>
      {sub && <span className={m.cardSub}>{sub}</span>}
      {history && <Sparkline points={history} max={max} />}
    </div>
  )
}

// ─── Страница ────────────────────────────────────────────────────────────────

export function AdminMetrics() {
  const { data, isError } = useServerMetrics()
  // История для спарклайнов копится на клиенте по мере опроса.
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const [txHist, setTxHist] = useState<number[]>([])
  const [rxHist, setRxHist] = useState<number[]>([])
  const lastTs = useRef<number>(0)

  useEffect(() => {
    if (!data || data.ts === lastTs.current) return
    lastTs.current = data.ts
    const push = (arr: number[], v: number) => [...arr, v].slice(-HISTORY)
    setCpuHist((a) => push(a, data.cpu_percent ?? 0))
    setTxHist((a) => push(a, data.net.tx_bytes_sec))
    setRxHist((a) => push(a, data.net.rx_bytes_sec))
  }, [data])

  if (isError)
    return (
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <h1>Сервер</h1>
        </div>
        <p className={m.cardSub}>Не удалось получить метрики сервера.</p>
      </div>
    )

  if (!data)
    return (
      <div className={styles.page}>
        <div className={styles.pageHeader}>
          <h1>Сервер</h1>
        </div>
        <Spinner />
      </div>
    )

  const netMax = Math.max(...txHist, ...rxHist, 1)

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Сервер</h1>
        <span className={m.live}>
          <span className={m.liveDot} /> в реальном времени
        </span>
      </div>

      <div className={m.grid}>
        <Card
          label="CPU"
          value={data.cpu_percent != null ? data.cpu_percent.toFixed(0) : '—'}
          unit={data.cpu_percent != null ? '%' : undefined}
          sub={loadSub(data)}
          history={cpuHist}
          max={100}
        />
        <Card
          label="Отдача (out)"
          value={fmtRate(data.net.tx_bytes_sec)}
          history={txHist}
          max={netMax}
        />
        <Card
          label="Приём (in)"
          value={fmtRate(data.net.rx_bytes_sec)}
          history={rxHist}
          max={netMax}
        />
        <Card label="Память" value={memValue(data)} sub={memSub(data)} />
        <Card
          label="WebSocket-соединения"
          value={String(data.ws_connections)}
          sub="активных сокетов (этот воркер)"
        />
        <Card
          label="Redis"
          value={data.redis.connected_clients != null ? String(data.redis.connected_clients) : '—'}
          sub={
            data.redis.used_memory != null
              ? `клиентов · ${fmtBytes(data.redis.used_memory)} памяти`
              : 'клиентов'
          }
        />
        <Card
          label="Пул БД"
          value={dbValue(data)}
          sub="занято / размер пула"
        />
        <Card label="Аптайм" value={fmtUptime(data.uptime_seconds)} sub="с последнего рестарта" />
      </div>
    </div>
  )
}

function loadSub(d: ServerMetricsOut): string | undefined {
  if (!d.load_avg) return undefined
  return `load: ${d.load_avg.map((x) => x.toFixed(2)).join(' · ')}`
}

function memValue(d: ServerMetricsOut): string {
  if (!d.mem) return '—'
  return `${((d.mem.used / d.mem.total) * 100).toFixed(0)}%`
}

function memSub(d: ServerMetricsOut): string | undefined {
  if (!d.mem) return undefined
  return `${fmtBytes(d.mem.used)} / ${fmtBytes(d.mem.total)}`
}

function dbValue(d: ServerMetricsOut): string {
  if (d.db_pool.checked_out == null || d.db_pool.size == null) return '—'
  return `${d.db_pool.checked_out} / ${d.db_pool.size}`
}
