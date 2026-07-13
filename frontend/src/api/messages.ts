import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { JournalSection, MessageOut, ReadStateOut, RefKind } from '../lib/types'
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
  // Ссылка на материал КБ / задачу (одна на сообщение). Оба поля вместе.
  ref_kind?: RefKind
  ref_id?: number
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

// Репост сообщения в новостной канал (только admin). sourceRoomId — комната-источник
// (в URL), сам пост создаётся в новостном канале. Пост придёт подписчикам новостей
// по WS message.new — локальный кэш не трогаем. Не-хук: вызывается из submit композера.
export const repostMessage = (sourceRoomId: number, id: number): Promise<MessageOut> =>
  http.post<MessageOut>(`/api/rooms/${sourceRoomId}/messages/${id}/repost`, {})

// Раздел дневника, «заряженный» в композер: минимум полей buildJournalContent.
// Полный список разделов приходит из активного задания (см. api/journal.ts).
export type JournalSectionMeta = Pick<
  JournalSection,
  'key' | 'emoji' | 'label' | 'heading' | 'input_type'
>

// Собирает content журнальной записи из раздела активного задания: невидимый
// маркер раздела (по нему сервер засчитывает раздел дня, см. backend
// `_journal_category`) + markdown-заголовок + необязательное тело. Тело может быть
// пустым, если запись несёт вложение/голос/стикер.
export function buildJournalContent(section: JournalSectionMeta, text: string): string {
  const value = text.trim()
  const marker = `<!--journal:${section.key}-->`
  if (section.input_type === 'title') {
    // Однострочный ввод сам становится заголовком (как прежний «фильм дня»);
    // без него — подпись раздела как нейтральный дефолт.
    return `${marker}\n\n## ${section.emoji} ${value || section.label}`
  }
  const body = value ? `\n\n${value}` : ''
  return `${marker}\n\n${section.heading}${body}`
}

// Карта {дата: [ключи разделов]} за месяц. День закрыт, когда есть все разделы
// задания, активного в этот день (см. backend get_journal_days).
export type JournalDays = Record<string, string[]>

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
