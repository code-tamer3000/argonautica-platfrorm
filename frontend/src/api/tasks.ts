import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '../lib/apiClient'
import type { AttachmentOut } from '../lib/types'

// --- Контракт бэкенда (поля = ответы API) ---

export type TaskType = 'common' | 'individual' | 'pair'
export type MyTaskStatus = 'assigned' | 'submitted' | 'returned' | 'accepted' | null

export interface TaskOut {
  id: number
  type: TaskType
  title: string
  body: string | null
  kb_item_id: number | null
  pair_id: number | null // задан только у перекрёстной задачи (взаимное обучение)
  deadline_at: string | null
  created_by: number
  created_at: string
  attachments: AttachmentOut[]
}

// Один участник пары в глазах смотрящего + выданная им перекрёстная задача.
export interface PairMemberOut {
  user_id: number
  is_meeting_organizer: boolean
  cross_task_id: number | null
}

export interface PairOut {
  pair_id: number
  members: PairMemberOut[]
  meeting_at: string | null
  viewer_user_id: number | null // чьими глазами смотрим (null у админа-неучастника)
  can_manage_meeting: boolean
}

export interface TaskWithStatusOut extends TaskOut {
  my_status: MyTaskStatus
  late: boolean
  deadline_soon: boolean
  assignee_count: number | null
  submitted_count: number
  accepted_count: number
  unreviewed_count: number
  total_recipients: number
  // Только для type='pair': пары смотрящего (участник — свою; админ — все).
  pairs: PairOut[] | null
}

export interface ProgressOut {
  done: number
  total: number
}

export interface TaskListOut {
  items: TaskWithStatusOut[]
  progress: ProgressOut
  attention_count: number
}

export interface SubmissionOut {
  id: number
  assignment_id: number
  user_id: number
  body: string | null
  created_at: string
  attachments: AttachmentOut[]
}

export interface TaskTrackOut {
  assignment_id: number
  user_id: number
  status: string
  late: boolean
  reviewed_at: string | null
  submissions: SubmissionOut[]
}

export interface TaskCommentOut {
  id: number
  submission_id: number
  author_id: number
  body: string
  created_at: string
}

export interface AdminAssignmentOut {
  assignment_id: number
  user_id: number
  status: string
  late: boolean
  reviewed_at: string | null
  submission_count: number
}

// --- Query keys ---

export const tasksKey = ['tasks'] as const
export const taskKey = (id: number) => ['tasks', id] as const
export const taskSubmissionsKey = (id: number) => ['tasks', id, 'submissions'] as const
export const submissionCommentsKey = (submissionId: number) =>
  ['tasks', 'submissions', submissionId, 'comments'] as const
export const adminAssignmentsKey = (id: number) => ['tasks', id, 'assignments'] as const

// --- Список / деталь ---

export function useTasks() {
  return useQuery({
    queryKey: tasksKey,
    queryFn: () => http.get<TaskListOut>('/api/tasks'),
  })
}

export function useTask(id: number) {
  return useQuery({
    queryKey: taskKey(id),
    queryFn: () => http.get<TaskWithStatusOut>(`/api/tasks/${id}`),
    enabled: id > 0,
  })
}

// --- Admin CRUD ---

export interface PairInput {
  user_ids: [number, number]
}

export interface TaskCreateBody {
  type: TaskType
  title: string
  body?: string | null
  kb_item_id?: number | null
  deadline_at?: string | null
  assignee_ids?: number[]
  pairs?: PairInput[]
  media_asset_ids?: number[]
}

export interface TaskUpdateBody {
  title?: string
  body?: string | null
  deadline_at?: string | null
  kb_item_id?: number | null
  media_asset_ids?: number[]
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TaskCreateBody) => http.post<TaskOut>('/api/tasks', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & TaskUpdateBody) =>
      http.patch<TaskOut>(`/api/tasks/${id}`, body),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: tasksKey })
      qc.invalidateQueries({ queryKey: taskKey(task.id) })
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => http.del<null>(`/api/tasks/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: tasksKey }),
  })
}

// --- Сдачи (submissions) ---

export function useTaskSubmissions(id: number) {
  return useQuery({
    queryKey: taskSubmissionsKey(id),
    queryFn: () => http.get<TaskTrackOut[]>(`/api/tasks/${id}/submissions`),
    enabled: id > 0,
  })
}

export interface SubmissionCreateBody {
  body?: string | null
  attachment_ids?: number[]
}

export function useCreateSubmission(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SubmissionCreateBody) =>
      http.post<SubmissionOut>(`/api/tasks/${id}/submissions`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskSubmissionsKey(id) })
      qc.invalidateQueries({ queryKey: taskKey(id) })
      qc.invalidateQueries({ queryKey: tasksKey })
    },
  })
}

// --- Ревью (admin) ---

export interface ReviewBody {
  assignmentId: number
  taskId: number
  action: 'accept' | 'return'
  comment?: string
}

export function useReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ assignmentId, action, comment }: ReviewBody) =>
      http.post<null>(`/api/tasks/assignments/${assignmentId}/review`, { action, comment }),
    onSuccess: (_r, { taskId }) => {
      qc.invalidateQueries({ queryKey: taskSubmissionsKey(taskId) })
      qc.invalidateQueries({ queryKey: adminAssignmentsKey(taskId) })
      qc.invalidateQueries({ queryKey: taskKey(taskId) })
      qc.invalidateQueries({ queryKey: tasksKey })
    },
  })
}

// --- Комментарии под сдачей (плоские) ---

export function useSubmissionComments(submissionId: number) {
  return useQuery({
    queryKey: submissionCommentsKey(submissionId),
    queryFn: () =>
      http.get<TaskCommentOut[]>(`/api/tasks/submissions/${submissionId}/comments`),
    enabled: submissionId > 0,
  })
}

export function useCreateSubmissionComment(submissionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) =>
      http.post<TaskCommentOut>(`/api/tasks/submissions/${submissionId}/comments`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: submissionCommentsKey(submissionId) }),
  })
}

export function useDeleteTaskComment(submissionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: number) => http.del<null>(`/api/tasks/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: submissionCommentsKey(submissionId) }),
  })
}

// --- Admin: назначения по задаче ---

export function useAdminAssignments(id: number) {
  return useQuery({
    queryKey: adminAssignmentsKey(id),
    queryFn: () => http.get<AdminAssignmentOut[]>(`/api/tasks/${id}/assignments`),
    enabled: id > 0,
  })
}

// --- Пары (взаимное обучение) ---

function invalidateTask(qc: ReturnType<typeof useQueryClient>, taskId: number) {
  qc.invalidateQueries({ queryKey: tasksKey })
  qc.invalidateQueries({ queryKey: taskKey(taskId) })
}

// Назначить/перенести (meeting_at) или отменить (null) встречу пары.
export function useUpdateMeeting(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pairId, meetingAt }: { pairId: number; meetingAt: string | null }) =>
      http.patch<null>(`/api/tasks/${taskId}/pairs/${pairId}/meeting`, {
        meeting_at: meetingAt,
      }),
    onSuccess: () => invalidateTask(qc, taskId),
  })
}

export interface CrossTaskBody {
  title: string
  body?: string | null
  deadline_at?: string | null
  media_asset_ids?: number[]
}

// Выдать задачу партнёру (получатель предопределён).
export function useCreateCrossTask(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pairId, ...body }: { pairId: number } & CrossTaskBody) =>
      http.post<TaskOut>(`/api/tasks/${taskId}/pairs/${pairId}/cross-task`, body),
    onSuccess: () => invalidateTask(qc, taskId),
  })
}

// Править выданную перекрёстную задачу (пока нет сдач).
export function useUpdateCrossTask(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pairId,
      crossTaskId,
      ...body
    }: { pairId: number; crossTaskId: number } & Partial<CrossTaskBody>) =>
      http.patch<TaskOut>(
        `/api/tasks/${taskId}/pairs/${pairId}/cross-task/${crossTaskId}`,
        body,
      ),
    onSuccess: (t) => {
      invalidateTask(qc, taskId)
      qc.invalidateQueries({ queryKey: taskKey(t.id) })
    },
  })
}

// Admin: заменить участника пары (только пока внутри пары ничего не выдано).
export function useReplacePairMember(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pairId,
      oldUserId,
      newUserId,
    }: {
      pairId: number
      oldUserId: number
      newUserId: number
    }) =>
      http.patch<null>(`/api/tasks/${taskId}/pairs/${pairId}`, {
        old_user_id: oldUserId,
        new_user_id: newUserId,
      }),
    onSuccess: () => invalidateTask(qc, taskId),
  })
}

// Admin: расформировать пару (скрытое действие).
export function useDeletePair(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pairId: number) =>
      http.del<null>(`/api/tasks/${taskId}/pairs/${pairId}`),
    onSuccess: () => invalidateTask(qc, taskId),
  })
}
