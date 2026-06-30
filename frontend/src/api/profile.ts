import { useMutation } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { UserOut } from '../lib/types'

export interface PatchMeBody {
  display_name?: string
  bio?: string | null
  avatar_media_id?: number | null
}

export function usePatchMe() {
  return useMutation({
    mutationFn: (body: PatchMeBody) => http.patch<UserOut>('/api/auth/me', body),
  })
}
