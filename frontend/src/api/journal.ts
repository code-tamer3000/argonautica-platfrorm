import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { JournalProgram, JournalSection, JournalStructure } from '../lib/types'

// --- Тело запросов админки (без position — его назначает сервер по порядку) ---

export interface JournalSectionInput {
  key: string
  emoji: string
  label: string
  heading: string
  placeholder: string
  input_type: JournalSection['input_type']
}

export interface JournalProgramBody {
  starts_on: string
  title: string | null
  description: string | null
  sections: JournalSectionInput[]
}

// --- Пользовательская структура (активное задание) ---

export const journalStructureKey = ['journal', 'structure'] as const

export function useJournalStructure() {
  return useQuery({
    queryKey: journalStructureKey,
    queryFn: () => http.get<JournalStructure>('/api/dynamics/structure'),
  })
}

// --- Админка: список заданий + CRUD ---

export const journalProgramsKey = ['journal', 'programs'] as const

export function useJournalPrograms() {
  return useQuery({
    queryKey: journalProgramsKey,
    queryFn: () => http.get<JournalProgram[]>('/api/admin/journal/programs'),
  })
}

export function useCreateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: JournalProgramBody) =>
      http.post<JournalProgram>('/api/admin/journal/programs', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalProgramsKey })
      qc.invalidateQueries({ queryKey: journalStructureKey })
    },
  })
}

export function useUpdateProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<JournalProgramBody>) =>
      http.patch<JournalProgram>(`/api/admin/journal/programs/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalProgramsKey })
      qc.invalidateQueries({ queryKey: journalStructureKey })
    },
  })
}

export function useDeleteProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/admin/journal/programs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: journalProgramsKey })
      qc.invalidateQueries({ queryKey: journalStructureKey })
    },
  })
}
