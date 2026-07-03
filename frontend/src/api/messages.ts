import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MessageOut, ReadStateOut } from '../lib/types'
import { toast } from '../stores/toast'
import { roomsKey } from './rooms'
import { appendMessage } from './cache'

export const messagesKey = (roomId: number) => ['messages', roomId] as const
export type MessagesData = InfiniteData<MessageOut[], number>

const PAGE = 40

// Лента: бэкенд отдаёт верхний уровень, newest-first. Курсор `before` = id для старых.
export function useMessages(roomId: number) {
  return useInfiniteQuery({
    queryKey: messagesKey(roomId),
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: String(PAGE) })
      if (pageParam) q.set('before', String(pageParam))
      return http.get<MessageOut[]>(`/api/rooms/${roomId}/messages?${q.toString()}`)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE ? lastPage[lastPage.length - 1].id : undefined,
  })
}

export interface SendBody {
  content?: string
  sticker_id?: number
  attachment_ids?: number[]
  reply_to_message_id?: number
}

export function useSendMessage(roomId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SendBody) => http.post<MessageOut>(`/api/rooms/${roomId}/messages`, body),
    // WS тоже доставит message.new (своё) — appendMessage дедуплицирует по id.
    onSuccess: (msg) => {
      if (msg.thread_root_id === null) appendMessage(qc, roomId, msg)
    },
  })
}

export function useEditMessage(roomId: number) {
  return useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      http.patch<MessageOut>(`/api/rooms/${roomId}/messages/${id}`, { content }),
  })
}

export function useDeleteMessage(roomId: number) {
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/rooms/${roomId}/messages/${id}`),
  })
}

// Репост сообщения в новостной канал (только admin). Пост попадёт к подписчикам
// новостей через WS message.new — локальный кэш не трогаем.
export function useRepostMessage(roomId: number) {
  return useMutation({
    mutationFn: (id: number) =>
      http.post<MessageOut>(`/api/rooms/${roomId}/messages/${id}/repost`, {}),
    onSuccess: () => toast('Отправлено в новости'),
    onError: () => toast('Не удалось отправить в новости', 'error'),
  })
}

// Категории дневника личного канала. Порядок = порядок публикации в UI.
export type JournalCategory = 'focus' | 'notes' | 'film'
export const JOURNAL_CATEGORIES: JournalCategory[] = ['focus', 'notes', 'film']

// Карта {дата: [категории]} за месяц. День закрыт, когда есть все три категории.
export type JournalDays = Record<string, JournalCategory[]>

export function useJournalDays(roomId: number, year: number, month: number, enabled = true) {
  return useQuery({
    queryKey: ['journal-days', roomId, year, month],
    queryFn: () =>
      http.get<JournalDays>(`/api/rooms/${roomId}/journal-days?year=${year}&month=${month}`),
    enabled,
  })
}

export function useMarkRead(roomId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lastReadId: number) =>
      http.post<ReadStateOut>(`/api/rooms/${roomId}/read`, { last_read_message_id: lastReadId }),
    onSuccess: (state) => {
      qc.setQueryData<import('../lib/types').RoomOut[]>(roomsKey, (old) =>
        old?.map((r) => (r.id === roomId ? { ...r, unread_count: state.unread_count } : r)),
      )
    },
  })
}
