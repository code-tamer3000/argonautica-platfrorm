import { useEffect, useState } from 'react'
import { wsClient, type WsStatus } from '../lib/wsClient'

// Единый статус связи для баннера. Смысл — снять с пользователя догадку
// «это у меня лагает или у них»: показываем явно, когда мы офлайн или связь
// деградировала.
//   - 'online'       — сеть есть, WS открыт и отзывчив: всё хорошо, баннер скрыт
//   - 'reconnecting' — сеть есть, но WS ещё/уже не открыт дольше порога, ИЛИ
//                      формально открыт, но не отвечает (зомби-соединение,
//                      ARG-161) — «плохое соединение»
//   - 'offline'      — браузер сообщает navigator.onLine === false
export type ConnectionState = 'online' | 'reconnecting' | 'offline'

// Сколько ждём восстановления WS, прежде чем признать соединение плохим. Короткие
// разрывы (реконнект за секунду) не должны мигать баннером.
const DEGRADED_AFTER_MS = 4000

export function useConnectionStatus(): ConnectionState {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [ws, setWs] = useState<WsStatus>(() => wsClient.getStatus())
  // 'open' сразу; уход в не-open откладываем на DEGRADED_AFTER_MS, чтобы баннер
  // не вспыхивал на каждом коротком реконнекте.
  const [degraded, setDegraded] = useState(false)
  // Соединение формально open, но зомби — не ответило на ping/что-либо за
  // PONG_TIMEOUT_MS (wsClient.ts, ARG-161). Раньше единственным сигналом был сам
  // факт обрыва сокета — то есть уже случившийся полный отказ, а не деградация,
  // пока сокет ещё жив.
  const [live, setLive] = useState(() => wsClient.isLive())

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => wsClient.onStatus(setWs), [])
  useEffect(() => wsClient.onLiveness(setLive), [])

  useEffect(() => {
    if (ws === 'open') {
      setDegraded(false)
      return
    }
    const t = window.setTimeout(() => setDegraded(true), DEGRADED_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [ws])

  if (!online) return 'offline'
  if (degraded || !live) return 'reconnecting'
  return 'online'
}
