import type { ComponentType } from 'react'
import { AdminBroadcast } from './AdminBroadcast'
import { AdminCabin } from './AdminCabin'
import { AdminCalendar } from './AdminCalendar'
import { AdminDynamics } from './AdminDynamics'
import { AdminFaq } from './AdminFaq'
import { AdminFeedback } from './AdminFeedback'
import { AdminJournal } from './AdminJournal'
import { AdminKb } from './AdminKb'
import { AdminPlans } from './AdminPlans'
import { AdminStickers } from './AdminStickers'
import { AdminSurvey } from './AdminSurvey'
import { AdminTasks } from './AdminTasks'
import { AdminUsers } from './AdminUsers'

export type AdminGroupKey = 'intake' | 'progress' | 'support'

export const ADMIN_GROUPS: { key: AdminGroupKey; label: string }[] = [
  { key: 'intake', label: 'Приём' },
  { key: 'progress', label: 'Прохождение' },
  { key: 'support', label: 'Поддержка' },
]

export interface AdminSection {
  path: string
  label: string
  group: AdminGroupKey
  Component: ComponentType
}

// Единственный источник состава и порядка разделов админки: боковое меню
// (AdminLayout) и роуты (AppShell) строятся из этого массива — убрать раздел
// отсюда значит убрать и пункт меню, и маршрут.
export const ADMIN_SECTIONS: AdminSection[] = [
  { path: 'plans', label: 'Тарифы', group: 'intake', Component: AdminPlans },
  { path: 'survey', label: 'Анкета', group: 'intake', Component: AdminSurvey },
  { path: 'users', label: 'Пользователи', group: 'intake', Component: AdminUsers },
  { path: 'dynamics', label: 'Динамика', group: 'progress', Component: AdminDynamics },
  { path: 'journal', label: 'Дневник', group: 'progress', Component: AdminJournal },
  { path: 'tasks', label: 'Задачи', group: 'progress', Component: AdminTasks },
  { path: 'calendar', label: 'Календарь', group: 'progress', Component: AdminCalendar },
  { path: 'kb', label: 'База знаний', group: 'progress', Component: AdminKb },
  { path: 'cabin', label: 'Каюта', group: 'progress', Component: AdminCabin },
  { path: 'feedback', label: 'Обращения', group: 'support', Component: AdminFeedback },
  { path: 'faq', label: 'FAQ', group: 'support', Component: AdminFaq },
  { path: 'broadcast', label: 'Рассылка', group: 'support', Component: AdminBroadcast },
  { path: 'stickers', label: 'Стикеры', group: 'support', Component: AdminStickers },
]

// Раздел, открывающийся по умолчанию при заходе на /admin (как было раньше —
// не завязан на порядок массива, чтобы перестановка групп не меняла лендинг).
export const ADMIN_DEFAULT_PATH = 'dynamics'
