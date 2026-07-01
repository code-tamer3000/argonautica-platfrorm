import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MediaUrlOut } from '../lib/types'

export function useMediaUrl(assetId: number | null) {
  return useQuery({
    queryKey: ['media', assetId],
    queryFn: () => http.get<MediaUrlOut>(`/api/media/${assetId}`),
    enabled: assetId != null,
    staleTime: 10 * 60_000, // presigned живёт 15 минут
  })
}
