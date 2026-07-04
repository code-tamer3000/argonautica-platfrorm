import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MessageOut, ReadStateOut } from '../lib/types'
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

// Репост сообщения в новостной канал (только admin). sourceRoomId — комната-источник
// (в URL), сам пост создаётся в новостном канале. Пост придёт подписчикам новостей
// по WS message.new — локальный кэш не трогаем. Не-хук: вызывается из submit композера.
export const repostMessage = (sourceRoomId: number, id: number): Promise<MessageOut> =>
  http.post<MessageOut>(`/api/rooms/${sourceRoomId}/messages/${id}/repost`, {})

// Категории дневника личного канала. Порядок = порядок публикации в UI.
export type JournalCategory = 'focus' | 'notes' | 'film'
export const JOURNAL_CATEGORIES: JournalCategory[] = ['focus', 'notes', 'film']

// Метаданные категорий для UI композера/бара. `heading` — заголовок публикуемой
// markdown-записи; для film заголовком служит сам введённый текст (название фильма).
export interface JournalCategoryMeta {
  key: JournalCategory
  emoji: string
  /** Короткая подпись на чипе и в контекст-баре композера. */
  label: string
  /** markdown-заголовок публикуемой записи (для film не используется). */
  heading: string
  placeholder: string
  multiline: boolean
}

export const JOURNAL_CATEGORY_META: Record<JournalCategory, JournalCategoryMeta> = {
  focus: {
    key: 'focus',
    emoji: '🎯',
    label: 'Фокус на день',
    heading: '## 🎯 Фокус на день',
    placeholder: 'Концентрация намерения на день',
    multiline: true,
  },
  notes: {
    key: 'notes',
    emoji: '📝',
    label: 'Заметки',
    heading: '## 📝 Заметки',
    placeholder: 'Процесс исследования',
    multiline: true,
  },
  film: {
    key: 'film',
    emoji: '🎬',
    label: 'Фильм дня',
    heading: '',
    placeholder: 'Как бы ты назвал фильм про сегодняшний день?',
    multiline: false,
  },
}

// Собирает content журнальной записи: невидимый маркер категории (по нему сервер
// засчитывает категорию дня, см. backend `_journal_category`) + markdown-заголовок +
// необязательное тело. Тело может быть пустым, если запись несёт вложение/голос/стикер.
export function buildJournalContent(category: JournalCategory, text: string): string {
  const value = text.trim()
  const marker = `<!--journal:${category}-->`
  if (category === 'film') {
    // Название фильма само по себе — заголовок; без него — нейтральный дефолт.
    return `${marker}\n\n## 🎬 ${value || 'Фильм дня'}`
  }
  const heading = JOURNAL_CATEGORY_META[category].heading
  const body = value ? `\n\n${value}` : ''
  return `${marker}\n\n${heading}${body}`
}

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
