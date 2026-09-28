// Реконнектящийся WebSocket-клиент (обязателен: blue-green рвёт сокеты).
// Слой доставки: переподписка комнат после реконнекта, heartbeat-ping, листенеры событий.
import { getAccessToken } from './tokens'
import type { WsEvent } from './types'

type Listener = (e: WsEvent) => void
type VoidFn = () => void

// Состояние сокета для индикатора связи: connecting/open — норма, closed — потеряли.
export type WsStatus = 'connecting' | 'open' | 'closed'
type StatusFn = (s: WsStatus) => void
type LivenessFn = (live: boolean) => void

// Раз в столько шлём ping, пока сокет open — служит и heartbeat'ом, и таймером
// обнаружения зомби-соединения (ARG-161): сокращён с прежних 25с специально ради
// более быстрого обнаружения деградации, не только ради поддержания соединения.
const PING_INTERVAL_MS = 10_000
// Если с момента отправки ping не пришло вообще ничего (ни pong, ни любое другое
// серверное событие — оно тоже считается признаком живости) за это время, пока
// ws.readyState формально ещё OPEN — считаем соединение деградировавшим (ARG-161).
const PONG_TIMEOUT_MS = 6_000

class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private connectListeners = new Set<VoidFn>()
  private statusListeners = new Set<StatusFn>()
  private livenessListeners = new Set<LivenessFn>()
  private subscribed = new Set<number>()
  private reconnectAttempts = 0
  private shouldRun = false
  private pingTimer: number | null = null
  private reconnectTimer: number | null = null
  private pongTimeoutTimer: number | null = null
  private lastActivityAt = 0
  private status: WsStatus = 'closed'
  // Сокет формально open, но давно ничего не отвечал — зомби-соединение (ARG-161).
  // Не путать с WsStatus: тот меняется только на настоящем onopen/onclose.
  private live = true

  getStatus(): WsStatus {
    return this.status
  }

  /** Текущая отзывчивость соединения (см. `live` выше) для начального состояния хука. */
  isLive(): boolean {
    return this.live
  }

  /** Подписка на смену состояния сокета (для индикатора связи). */
  onStatus(fn: StatusFn): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  /** Подписка на смену отзывчивости живого соединения (ARG-161, см. `live`). */
  onLiveness(fn: LivenessFn): () => void {
    this.livenessListeners.add(fn)
    return () => this.livenessListeners.delete(fn)
  }

  private setStatus(s: WsStatus): void {
    if (this.status === s) return
    this.status = s
    this.statusListeners.forEach((fn) => fn(s))
  }

  private setLive(v: boolean): void {
    if (this.live === v) return
    this.live = v
    this.livenessListeners.forEach((fn) => fn(v))
  }

  start(): void {
    if (this.shouldRun) return
    this.shouldRun = true
    this.connect()
  }

  stop(): void {
    this.shouldRun = false
    this.clearTimers()
    this.subscribed.clear()
    this.ws?.close()
    this.ws = null
    this.setStatus('closed')
    this.setLive(true)
  }

  /** Форсировать немедленный реконнект (напр. вкладку вернули из фона). */
  reconnectNow(): void {
    if (!this.shouldRun) return
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0
    this.connect()
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Вызывается при каждом установлении WS-соединения (включая реконнект). */
  onConnect(fn: VoidFn): () => void {
    this.connectListeners.add(fn)
    return () => this.connectListeners.delete(fn)
  }

  subscribe(roomId: number): void {
    this.subscribed.add(roomId)
    this.send({ type: 'subscribe', room_id: roomId })
  }

  unsubscribe(roomId: number): void {
    this.subscribed.delete(roomId)
    this.send({ type: 'unsubscribe', room_id: roomId })
  }

  typing(roomId: number): void {
    this.send({ type: 'typing', room_id: roomId })
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  private clearTimers(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer)
      this.pingTimer = null
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pongTimeoutTimer !== null) {
      window.clearTimeout(this.pongTimeoutTimer)
      this.pongTimeoutTimer = null
    }
  }

  /** Шлёт ping и взводит таймаут обнаружения зомби-соединения (ARG-161). */
  private heartbeat(): void {
    this.send({ type: 'ping' })
    if (this.pongTimeoutTimer !== null) window.clearTimeout(this.pongTimeoutTimer)
    const sentAt = Date.now()
    this.pongTimeoutTimer = window.setTimeout(() => {
      // За время таймаута не пришло вообще ничего (ни pong, ни любое другое
      // событие) — сокет формально ещё open, но соединение зомби.
      if (this.lastActivityAt < sentAt) this.setLive(false)
    }, PONG_TIMEOUT_MS)
  }

  private connect(): void {
    if (!this.shouldRun) return
    this.setStatus('connecting')
    const token = getAccessToken()
    if (!token) {
      // access ещё не поднят (рефреш в процессе) — повторим скоро
      this.reconnectTimer = window.setTimeout(() => this.connect(), 500)
      return
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.setStatus('open')
      this.lastActivityAt = Date.now()
      this.setLive(true)
      for (const room of this.subscribed) this.send({ type: 'subscribe', room_id: room })
      this.pingTimer = window.setInterval(() => this.heartbeat(), PING_INTERVAL_MS)
      this.connectListeners.forEach((fn) => fn())
    }
    ws.onmessage = (ev) => {
      // Любое сообщение — признак живости, не только pong (ARG-161): в оживлённом
      // чате message.new/typing/presence приходят чаще, чем раз в PING_INTERVAL_MS,
      // и не нужно ждать именно pong, чтобы понять, что соединение отзывчиво.
      this.lastActivityAt = Date.now()
      this.setLive(true)
      try {
        const data = JSON.parse(ev.data) as WsEvent
        this.listeners.forEach((l) => l(data))
      } catch {
        // мусор — игнорируем
      }
    }
    ws.onclose = () => {
      this.clearTimers()
      this.setStatus(this.shouldRun ? 'connecting' : 'closed')
      this.setLive(true)
      if (!this.shouldRun) return
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000)
      this.reconnectAttempts += 1
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => ws.close()
  }
}

export const wsClient = new WsClient()
