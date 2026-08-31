import { useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type {
  CalendarEventOut,
  ExpeditionOut,
  JournalStructure,
  NewsPreviewOut,
  NotificationOut,
} from '../lib/types'
import type { TaskWithStatusOut } from './tasks'

// Композиция полей нескольких доменов — как и на бэкенде (schemas/expedition.py),
// держим DashboardOut рядом с эндпоинтом, а не в lib/types.ts (там TaskWithStatusOut
// не виден без обратной зависимости types.ts → api/tasks.ts).
export interface DashboardOut {
  expedition: ExpeditionOut | null // null — нет потока/расписания (напр. админ)
  journal: JournalStructure | null
  journal_today_done: boolean
  journal_locked: boolean
  upcoming_events: CalendarEventOut[]
  active_tasks: TaskWithStatusOut[]
  notifications: NotificationOut[]
  unread_notifications: number
  news_preview: NewsPreviewOut | null
}

export const dashboardKey = ['dashboard'] as const

export function useDashboard(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: () => http.get<DashboardOut>('/api/dashboard'),
    enabled: options?.enabled ?? true,
  })
}

export function useInvalidateDashboard() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: dashboardKey })
}
