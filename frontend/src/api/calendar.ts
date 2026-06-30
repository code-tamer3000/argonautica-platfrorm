import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { CalendarEventOut } from '../lib/types'

export const calendarEventsKey = (from?: string, to?: string) =>
  ['calendar', 'events', from ?? '', to ?? ''] as const

export function useCalendarEvents(from?: string, to?: string) {
  return useQuery({
    queryKey: calendarEventsKey(from, to),
    queryFn: () => {
      const q = new URLSearchParams()
      if (from) q.set('from', from)
      if (to) q.set('to', to)
      const qs = q.toString()
      return http.get<CalendarEventOut[]>(
        `/api/calendar/events${qs ? `?${qs}` : ''}`,
      )
    },
  })
}

export function useCalendarEvent(id: number) {
  return useQuery({
    queryKey: ['calendar', 'events', id],
    queryFn: () => http.get<CalendarEventOut>(`/api/calendar/events/${id}`),
    enabled: id > 0,
  })
}

export interface CalendarEventCreateBody {
  title: string
  description?: string | null
  starts_at: string        // ISO datetime
  ends_at?: string | null
  all_day?: boolean
  room_id?: number | null
}

export interface CalendarEventUpdateBody {
  title?: string
  description?: string | null
  starts_at?: string
  ends_at?: string | null
  all_day?: boolean
}

export function useCreateCalendarEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarEventCreateBody) =>
      http.post<CalendarEventOut>('/api/calendar/events', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar', 'events'] }),
  })
}

export function useUpdateCalendarEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & CalendarEventUpdateBody) =>
      http.patch<CalendarEventOut>(`/api/calendar/events/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar', 'events'] }),
  })
}

export function useDeleteCalendarEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/calendar/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar', 'events'] }),
  })
}
