// Реконнектящийся WebSocket-клиент (обязателен: blue-green рвёт сокеты).
// Слой доставки: переподписка комнат после реконнекта, heartbeat-ping, листенеры событий.
import { getAccessToken } from './tokens'
import type { WsEvent } from './types'

type Listener = (e: WsEvent) => void
type VoidFn = () => void

// Состояние сокета для индикатора связи: connecting/open — норма, closed — потеряли.
export type WsStatus = 'connecting' | 'open' | 'closed'
type StatusFn = (s: WsStatus) => void

class WsClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private connectListeners = new Set<VoidFn>()
  private statusListeners = new Set<StatusFn>()
  private subscribed = new Set<number>()
  private reconnectAttempts = 0
  private shouldRun = false
  private pingTimer: number | null = null
  private reconnectTimer: number | null = null
  private status: WsStatus = 'closed'

  getStatus(): WsStatus {
    return this.status
  }

  /** Подписка на смену состояния сокета (для индикатора связи). */
  onStatus(fn: StatusFn): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private setStatus(s: WsStatus): void {
    if (this.status === s) return
    this.status = s
    this.statusListeners.forEach((fn) => fn(s))
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
      for (const room of this.subscribed) this.send({ type: 'subscribe', room_id: room })
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 25_000)
      this.connectListeners.forEach((fn) => fn())
    }
    ws.onmessage = (ev) => {
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
      if (!this.shouldRun) return
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15_000)
      this.reconnectAttempts += 1
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => ws.close()
  }
}

export const wsClient = new WsClient()
