import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'

/** Вид вопроса — канон живёт в бэкенде (app/services/survey_form.py). */
export type SurveyQuestionKind = 'text' | 'multi'

export interface SurveyOption {
  key: string
  label: string
}

export interface SurveyQuestion {
  key: string
  kind: SurveyQuestionKind
  title: string
  required: boolean
  hint: string | null
  placeholder: string | null
  options: SurveyOption[]
  min_length: number
  max_length: number
  comment_title: string | null
  comment_required: boolean
}

export interface SurveyForm {
  version: number
  title: string
  subtitle: string
  intro: string
  consent_label: string
  questions: SurveyQuestion[]
  completed_at: string | null
  required: boolean
  gift_available: boolean
}

/** Ответ на один вопрос. Форма зависит от kind — см. survey_form.py. */
export interface SurveyAnswer {
  /** text */
  text?: string
  /** multi */
  choices?: string[]
  comment?: string
}

export type SurveyAnswers = Record<string, SurveyAnswer>

export interface SurveyGift {
  url: string
  expires_in: number
  filename: string
}

export interface SurveyRow {
  user_id: number
  username: string
  display_name: string
  invited: boolean
  completed_at: string | null
  publish_consent: boolean
  has_gift: boolean
  gift_asset_id: number | null
  answers: SurveyAnswers | null
  version: number | null
}

export interface SurveyOverview {
  form: Omit<SurveyForm, 'completed_at' | 'required' | 'gift_available'>
  rows: SurveyRow[]
  invited_count: number
  completed_count: number
}

export const surveyFormKey = ['survey', 'form'] as const
export const adminSurveyKey = ['admin', 'survey'] as const

/** Форма анкеты + состояние текущего пользователя по ней. */
export function useSurveyForm() {
  return useQuery({
    queryKey: surveyFormKey,
    queryFn: () => http.get<SurveyForm>('/api/survey/me'),
    // Не Infinity: книгу админ может привязать уже ПОСЛЕ того, как человек сдал
    // анкету — профиль должен подхватить её без перезагрузки страницы.
    staleTime: 60_000,
  })
}

/** Отправить анкету. После успеха платформа разблокируется (refreshMe). */
export function useSubmitSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { answers: SurveyAnswers; publish_consent: boolean }) =>
      http.post<{ gift_available: boolean }>('/api/survey', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: surveyFormKey }),
  })
}

/** Presigned-ссылка на личную книгу. Дёргаем по клику, а не заранее. */
export function useSurveyGift() {
  return useMutation({
    mutationFn: () => http.get<SurveyGift>('/api/survey/gift'),
  })
}

/** Админская сводка: кому показана анкета, кто сдал, что ответил. */
export function useAdminSurvey() {
  return useQuery({
    queryKey: adminSurveyKey,
    queryFn: () => http.get<SurveyOverview>('/api/admin/survey'),
  })
}

/** Показать анкету выбранным участникам. */
export function useInviteSurvey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userIds: number[]) =>
      http.post<null>('/api/admin/survey/invite', { user_ids: userIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminSurveyKey }),
  })
}

/** Снять блокировку с человека, не дожидаясь анкеты. */
export function useCancelSurveyInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) => http.del<null>(`/api/admin/survey/invite/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminSurveyKey }),
  })
}

/** Привязать/отвязать личную книгу участника. */
export function useSetSurveyGift() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, assetId }: { userId: number; assetId: number | null }) =>
      http.patch<null>(`/api/admin/survey/gift/${userId}`, { media_asset_id: assetId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: adminSurveyKey }),
  })
}
