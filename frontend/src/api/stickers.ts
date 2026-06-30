import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { http } from '../lib/apiClient'
import type { StickerOut, StickerpackOut } from '../lib/types'

export const stickerpacksKey = ['stickerpacks'] as const

export function useStickerpacks() {
  return useQuery({
    queryKey: stickerpacksKey,
    queryFn: () => http.get<StickerpackOut[]>('/api/stickerpacks'),
    staleTime: 60_000,
  })
}

export function useStickerMap(): Map<number, StickerOut> {
  const { data } = useStickerpacks()
  return useMemo(() => {
    const m = new Map<number, StickerOut>()
    for (const pack of data ?? []) for (const s of pack.stickers) m.set(s.id, s)
    return m
  }, [data])
}

export function useCreatePack() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => http.post<StickerpackOut>('/api/stickerpacks', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: stickerpacksKey }),
  })
}

export function useAddSticker(packId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { image_media_id: number; keyword?: string }) =>
      http.post<StickerOut>(`/api/stickerpacks/${packId}/stickers`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: stickerpacksKey }),
  })
}
