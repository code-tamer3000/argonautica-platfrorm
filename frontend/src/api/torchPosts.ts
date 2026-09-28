import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { TorchPostOut } from '../lib/types'

// Лента постов КОНКРЕТНОГО профиля (ARG-155/164) — не общая лента клуба.
export const torchPostsKey = (userId: number) => ['torchPosts', userId] as const

export function useTorchPosts(userId: number, enabled: boolean) {
  return useQuery({
    queryKey: torchPostsKey(userId),
    queryFn: () => http.get<TorchPostOut[]>(`/api/torch/posts?user_id=${userId}`),
    enabled,
  })
}

export function useCreateTorchPost(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => http.post<TorchPostOut>('/api/torch/posts', { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: torchPostsKey(userId) }),
  })
}

export function useDeleteTorchPost(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (postId: number) => http.del(`/api/torch/posts/${postId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: torchPostsKey(userId) }),
  })
}
