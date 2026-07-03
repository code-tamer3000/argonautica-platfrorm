import { useMemo } from 'react'
import { useRooms } from '../../api/rooms'

export interface NavBadges {
  chats: number // Σ непрочитанных по личкам и группам
  channels: number // Σ по каналам (кроме новостей)
  news: number // непрочитанные в новостном канале
  rubka: number // общий бейдж «Рубки» = chats + channels
}

// Агрегированные счётчики для бейджей навигации. Считаются из уже загруженных комнат
// (useRooms) — отдельный бэкенд не нужен, unread_count там уже есть.
export function useNavBadges(): NavBadges {
  const { data: rooms } = useRooms()
  return useMemo(() => {
    let chats = 0
    let channels = 0
    let news = 0
    for (const r of rooms ?? []) {
      if (r.is_news) news += r.unread_count
      else if (r.type === 'dm' || r.type === 'group') chats += r.unread_count
      else if (r.type === 'channel') channels += r.unread_count
    }
    return { chats, channels, news, rubka: chats + channels }
  }, [rooms])
}
