import { useMemo } from 'react'
import { useRooms } from '../../api/rooms'
import { useTasks } from '../../api/tasks'
import { useAuth } from '../auth/AuthContext'

export interface NavBadges {
  chats: number // Σ непрочитанных по личкам и группам
  channels: number // Σ по каналам (кроме новостей)
  news: number // непрочитанные в новостном канале
  rubka: number // общий бейдж «Рубки» = chats + channels
  tasks: number // задачи, требующие внимания (attention_count из GET /api/tasks)
}

// Агрегированные счётчики для бейджей навигации. Считаются из уже загруженных комнат
// (useRooms) — отдельный бэкенд не нужен, unread_count там уже есть. Бейдж задач
// берём из того же useTasks(), что и экран «Задачи» — общий кэш react-query.
export function useNavBadges(): NavBadges {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const isObserver = !!user?.is_observer
  const { data: rooms } = useRooms()
  // Наблюдателю задачи закрыты — эндпоинт не дёргаем (иначе 403), бейдж всё равно скрыт.
  const { data: tasks } = useTasks({ enabled: !isObserver })
  return useMemo(() => {
    let chats = 0
    let channels = 0
    let news = 0
    for (const r of rooms ?? []) {
      if (r.is_news) news += r.unread_count
      else if (r.type === 'dm' || r.type === 'group') chats += r.unread_count
      else if (r.type === 'channel') channels += r.unread_count
    }
    // Админ задачи не выполняет — бейдж «Задачи» для него всегда пуст.
    const taskBadge = isAdmin ? 0 : (tasks?.attention_count ?? 0)
    return { chats, channels, news, rubka: chats + channels, tasks: taskBadge }
  }, [rooms, tasks, isAdmin])
}
