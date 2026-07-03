import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { MyDynamicsOut, UserDynamicsOut } from '../lib/types'

export const myDynamicsKey = ['dynamics', 'me'] as const
export const adminDynamicsKey = ['dynamics', 'admin'] as const

export function useMyDynamics() {
  return useQuery({
    queryKey: myDynamicsKey,
    queryFn: () => http.get<MyDynamicsOut>('/api/dynamics/my-stats'),
  })
}

export function usePardon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: string) => http.post<MyDynamicsOut>('/api/dynamics/pardon', { date }),
    onSuccess: (data) => {
      qc.setQueryData(myDynamicsKey, data)
    },
  })
}

export function useAdminDynamics() {
  return useQuery({
    queryKey: adminDynamicsKey,
    queryFn: () => http.get<UserDynamicsOut[]>('/api/admin/dynamics'),
  })
}
