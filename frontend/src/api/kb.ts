import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { KbItemOut } from '../lib/types'

export const kbItemsKey = ['kb', 'items'] as const
export const kbItemKey = (id: number) => ['kb', 'items', id] as const

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
  media_asset_ids?: number[]
}

export interface KbItemUpdateBody {
  title?: string
  body?: string | null
  published?: boolean
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
