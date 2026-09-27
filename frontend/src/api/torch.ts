import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { PublicUserOut } from '../lib/types'

export interface TorchRow {
  user_id: number
  username: string
  display_name: string
  torch_unlocked: boolean
  torch_applied_at: string | null
}

export interface TorchAdminCandidate {
  user_id: number
  display_name: string
}

export interface TorchOverview {
  rows: TorchRow[]
  stub_text: string
  admin_user_id: number | null
  admin_candidates: TorchAdminCandidate[]
}

export interface TorchStub {
  stub_text: string
  apply_admin_id: number | null
}

export const torchStubKey = ['torch', 'stub'] as const
export const adminTorchKey = ['admin', 'torch'] as const

/** Текст заглушки для закрытого клуба — видно, только пока torch_unlocked=false. */
export function useTorchStub(enabled: boolean) {
  return useQuery({
    queryKey: torchStubKey,
    queryFn: () => http.get<TorchStub>('/api/torch/stub'),
    enabled,
  })
}

/** Выпустившиеся участники + их тумблер + текущая заглушка. */
export function useAdminTorch() {
  return useQuery({
    queryKey: adminTorchKey,
    queryFn: () => http.get<TorchOverview>('/api/admin/torch'),
  })
}

/** Открыть клуб выбранным выпускникам. */
export function useGrantTorch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userIds: number[]) =>
      http.post<null>('/api/admin/torch/grant', { user_ids: userIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminTorchKey }),
  })
}

/** Закрыть клуб конкретному участнику. */
export function useRevokeTorch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => http.del<null>(`/api/admin/torch/grant/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminTorchKey }),
  })
}

export const torchContactsKey = ['torch', 'contacts'] as const

/**
 * Контакты ВНУТРИ раздела «Факел» (ARG-54, часть 2) — члены клуба + любые
 * админы, без рангового каскада тарифов обычного `useContacts`. Не путать с
 * ним: это параллельный, более широкий круг видимости.
 */
export function useTorchContacts(enabled: boolean) {
  return useQuery({
    queryKey: torchContactsKey,
    queryFn: () => http.get<PublicUserOut[]>('/api/torch/contacts'),
    enabled,
  })
}

/** Обновить общий текст заглушки. */
export function useUpdateTorchStub() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stubText: string) =>
      http.patch<null>('/api/admin/torch/stub', { stub_text: stubText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminTorchKey }),
  })
}

/** Назначить (или снять, `null`) администратора Факела — с кем сводит кнопка
 * «Подать заявку» на гейте. */
export function useUpdateTorchAdmin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (adminUserId: number | null) =>
      http.patch<null>('/api/admin/torch/admin', { admin_user_id: adminUserId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminTorchKey }),
  })
}

export interface TorchApply {
  room_id: number
}

/** Кнопка «Подать заявку» на гейте: открыть/создать DM с назначенным админом. */
export function useApplyToTorch() {
  return useMutation({
    mutationFn: () => http.post<TorchApply>('/api/torch/apply', {}),
  })
}
