import { useQueries } from '@tanstack/react-query'
import { useKbItems } from '../../api/kb'
import { http } from '../../lib/apiClient'
import { isMarkdownUrl } from '../kb/MdAttachment'
import type { MediaUrlOut } from '../../lib/types'

/**
 * Resolve, by naming convention, the KB article that hosts the «64 пути» book so
 * a Gene Key reading can deep-link into it. We look for a published article whose
 * title contains the given text and that has a `.md` attachment; its id + the
 * markdown asset id give the reader route `/kb/read/:itemId/:assetId`.
 *
 * The book is a plain article with an attached markdown file — there is no
 * dedicated "book" entity — so the link simply disappears if no such article is
 * published yet.
 */
export function useGenkeysBookLink(titleMatch: string): { itemId: number; assetId: number } | null {
  const { data: items } = useKbItems()
  const needle = titleMatch.toLowerCase()

  const candidate = (items ?? []).find(
    (i) => i.published && i.title.toLowerCase().includes(needle) && i.media_asset_ids.length > 0,
  )

  const assetIds = candidate?.media_asset_ids ?? []
  // Resolve the candidate's attachments (only one item, so a bounded fan-out).
  const results = useQueries({
    queries: assetIds.map((assetId) => ({
      queryKey: ['media', assetId],
      queryFn: () => http.get<MediaUrlOut>(`/api/media/${assetId}`),
      staleTime: 12 * 60 * 60_000,
    })),
  })

  if (!candidate) return null
  for (let i = 0; i < assetIds.length; i++) {
    if (isMarkdownUrl(results[i]?.data?.url)) {
      return { itemId: candidate.id, assetId: assetIds[i] }
    }
  }
  return null
}
