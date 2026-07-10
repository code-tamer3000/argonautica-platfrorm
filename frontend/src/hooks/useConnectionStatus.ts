import { useEffect, useState } from 'react'
import { wsClient, type WsStatus } from '../lib/wsClient'

// Единый статус связи для баннера. Смысл — снять с пользователя догадку
// «это у меня лагает или у них»: показываем явно, когда мы офлайн или связь
// деградировала.
//   - 'online'       — сеть есть и WS открыт: всё хорошо, баннер скрыт
//   - 'reconnecting' — сеть есть, но WS ещё/уже не открыт дольше порога: «плохое соединение»
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

  useEffect(() => {
    if (ws === 'open') {
      setDegraded(false)
      return
    }
    const t = window.setTimeout(() => setDegraded(true), DEGRADED_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [ws])

  if (!online) return 'offline'
  if (degraded) return 'reconnecting'
  return 'online'
}
