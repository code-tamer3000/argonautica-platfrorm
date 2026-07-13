import { useQuery } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import { reportMetric } from '../lib/metrics'
import type { MediaUrlOut } from '../lib/types'

export function useMediaUrl(assetId: number | null) {
  return useQuery({
    queryKey: ['media', assetId],
    queryFn: async () => {
      // Измерительный слой: время presign-GET round-trip (фолбэк-путь БЗ, где адрес
      // тянется по id, а не приходит в ленте). Best-effort — не влияет на результат.
      const t0 = performance.now()
      const data = await http.get<MediaUrlOut>(`/api/media/${assetId}`)
      reportMetric({
        op: 'download',
        kind: data.kind ?? 'file',
        total_ms: performance.now() - t0,
        steps: { presign_ms: performance.now() - t0 },
      })
      return data
    },
    enabled: assetId != null,
    staleTime: 12 * 60 * 60_000, // presigned-GET живёт 24 ч — не перезапрашиваем зря
  })
}
