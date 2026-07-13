import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { KbCategoryOut, KbCommentOut, KbItemOut } from '../lib/types'

export const kbItemsKey = ['kb', 'items'] as const
export const kbItemKey = (id: number) => ['kb', 'items', id] as const
export const kbCategoriesKey = ['kb', 'categories'] as const
export const kbCommentsKey = (itemId: number) => ['kb', 'items', itemId, 'comments'] as const

// --- Категории (плоские) ---

export function useKbCategories() {
  return useQuery({
    queryKey: kbCategoriesKey,
    queryFn: () => http.get<KbCategoryOut[]>('/api/kb/categories'),
  })
}

export function useCreateKbCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; sort_order?: number }) =>
      http.post<KbCategoryOut>('/api/kb/categories', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbCategoriesKey }),
  })
}

export function useUpdateKbCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; title?: string; sort_order?: number }) =>
      http.patch<KbCategoryOut>(`/api/kb/categories/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbCategoriesKey }),
  })
}

export function useDeleteKbCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/kb/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: kbCategoriesKey })
      // Удаление категории обнуляет category_id материалов — перечитать список.
      qc.invalidateQueries({ queryKey: kbItemsKey })
    },
  })
}

export function useKbItems() {
  return useQuery({
    queryKey: kbItemsKey,
    queryFn: () => http.get<KbItemOut[]>('/api/kb/items'),
  })
}

export function useKbItem(id: number) {
  return useQuery({
    queryKey: kbItemKey(id),
    queryFn: () => http.get<KbItemOut>(`/api/kb/items/${id}`),
    enabled: id > 0,
  })
}

// Admin mutations (used in Phase 5 admin panel)
export interface KbItemCreateBody {
  title: string
  body?: string | null
  published?: boolean
  category_id?: number | null
  media_asset_ids?: number[]
}

export interface KbItemUpdateBody {
  title?: string
  body?: string | null
  published?: boolean
  category_id?: number | null
  sort_order?: number
}

export function useCreateKbItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: KbItemCreateBody) => http.post<KbItemOut>('/api/kb/items', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbItemsKey }),
  })
}

export function useUpdateKbItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & KbItemUpdateBody) =>
      http.patch<KbItemOut>(`/api/kb/items/${id}`, body),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: kbItemsKey })
      qc.invalidateQueries({ queryKey: kbItemKey(item.id) })
    },
  })
}

export function useDeleteKbItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/kb/items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbItemsKey }),
  })
}

export function useAttachKbMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, media_asset_ids }: { id: number; media_asset_ids: number[] }) =>
      http.post<KbItemOut>(`/api/kb/items/${id}/media`, { media_asset_ids }),
    onSuccess: (item) => qc.invalidateQueries({ queryKey: kbItemKey(item.id) }),
  })
}

export function useDetachKbMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, assetId }: { id: number; assetId: number }) =>
      http.del<null>(`/api/kb/items/${id}/media/${assetId}`),
    onSuccess: (_r, { id }) => qc.invalidateQueries({ queryKey: kbItemKey(id) }),
  })
}

// --- Комментарии под материалом (плоские) ---

export function useKbComments(itemId: number) {
  return useQuery({
    queryKey: kbCommentsKey(itemId),
    queryFn: () => http.get<KbCommentOut[]>(`/api/kb/items/${itemId}/comments`),
    enabled: itemId > 0,
  })
}

export function useCreateKbComment(itemId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      http.post<KbCommentOut>(`/api/kb/items/${itemId}/comments`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbCommentsKey(itemId) }),
  })
}

export function useDeleteKbComment(itemId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => http.del<null>(`/api/kb/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: kbCommentsKey(itemId) }),
  })
}
