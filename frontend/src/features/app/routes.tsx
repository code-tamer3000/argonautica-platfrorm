import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route } from 'react-router-dom'
import {
  IconBook,
  IconCalendar,
  IconChat,
  IconDiary,
  IconGenkeys,
  IconNews,
  IconSettings,
  IconSupport,
  IconTasks,
  IconUser,
} from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { ChatLayout } from '../chat/ChatLayout'
import { CalendarView } from '../calendar/CalendarView'
import { CabinScreen } from '../cabin/CabinScreen'
import { KbList } from '../kb/KbList'
import { KbViewer } from '../kb/KbViewer'
import { TasksList } from '../tasks/TasksList'
import { TaskDetail } from '../tasks/TaskDetail'
import { ProfileScreen } from '../profile/ProfileScreen'
import { SupportScreen } from '../support/SupportScreen'
import { AdminLayout } from '../admin/AdminLayout'
import { AdminDynamics } from '../admin/AdminDynamics'
import { AdminJournal } from '../admin/AdminJournal'
import { AdminKb } from '../admin/AdminKb'
import { AdminTasks } from '../admin/AdminTasks'
import { AdminCalendar } from '../admin/AdminCalendar'
import { AdminStickers } from '../admin/AdminStickers'
import { AdminUsers } from '../admin/AdminUsers'
import { AdminPlans } from '../admin/AdminPlans'
import { AdminFeedback } from '../admin/AdminFeedback'
import { AdminSurvey } from '../admin/AdminSurvey'
import { AdminFaq } from '../admin/AdminFaq'
import { AdminBroadcast } from '../admin/AdminBroadcast'
import { AdminCabin } from '../admin/AdminCabin'
import type { NavBadges } from './useNavBadges'
import type { Access } from './RequireAccess'

// Раздел «Генные ключи» тянет 64 markdown-файла — держим его в отдельном чанке,
// чтобы не раздувать основной бандл (грузится только при заходе в раздел).
const GeneKeysScreen = lazy(() =>
  import('../genkeys/GeneKeysScreen').then((m) => ({ default: m.GeneKeysScreen })),
)
const KbBookReader = lazy(() =>
  import('../kb/book/KbBookReader').then((m) => ({ default: m.KbBookReader })),
)

function withSuspense(LazyComponent: ComponentType) {
  return function Suspended() {
    return (
      <Suspense fallback={<div className="center grow"><Spinner /></div>}>
        <LazyComponent />
      </Suspense>
    )
  }
}

export interface RouteChild {
  path: string
  Component: ComponentType
}

export interface RouteEntry {
  path: string
  label: string
  icon: ComponentType
  access: Access
  badgeKey?: keyof NavBadges
  /** Для NavLink: `end` нужен только «/», иначе он подсвечен на любом вложенном пути. */
  end?: boolean
  /** Обычный случай: один компонент на path, плюс соседние маршруты без своего пункта в наве. */
  Component?: ComponentType
  children?: RouteChild[]
  /**
   * Спецслучай — свой вложенный <Route>-поддерева со своим layout/<Outlet/>.
   * Сейчас только у «/admin»: её 13 подмаршрутов остаются как есть (ARG-97 их не
   * трогает), здесь только оборачиваются в RequireAccess вместо ручной проверки
   * роли внутри AdminLayout.
   */
  renderRoutes?: () => ReactNode
}

export const routes: RouteEntry[] = [
  {
    path: '/',
    label: 'Рубка',
    icon: IconChat,
    access: { kind: 'observerBlocked', redirectTo: '/kb' },
    badgeKey: 'rubka',
    end: true,
    Component: () => <ChatLayout key="rubka" />,
  },
  {
    path: '/news',
    label: 'Новости',
    icon: IconNews,
    access: { kind: 'observerBlocked' },
    badgeKey: 'news',
    Component: () => <ChatLayout key="news" autoOpen="news" />,
  },
  {
    path: '/kb',
    label: 'База знаний',
    icon: IconBook,
    access: { kind: 'public' },
    Component: KbList,
    children: [
      { path: '/kb/:itemId', Component: KbViewer },
      { path: '/kb/read/:itemId/:assetId', Component: withSuspense(KbBookReader) },
    ],
  },
  {
    path: '/tasks',
    label: 'Задачи',
    icon: IconTasks,
    access: { kind: 'observerBlocked' },
    badgeKey: 'tasks',
    Component: TasksList,
    children: [{ path: '/tasks/:taskId', Component: TaskDetail }],
  },
  {
    path: '/calendar',
    label: 'Календарь',
    icon: IconCalendar,
    access: { kind: 'observerBlocked' },
    Component: CalendarView,
  },
  {
    path: '/genkeys',
    label: 'Генные замки',
    icon: IconGenkeys,
    access: { kind: 'public' },
    Component: withSuspense(GeneKeysScreen),
  },
  {
    path: '/cabin',
    label: 'Каюта',
    icon: IconDiary,
    access: { kind: 'requiresCabinGrant' },
    Component: CabinScreen,
  },
  {
    path: '/profile',
    label: 'Профиль',
    icon: IconUser,
    access: { kind: 'public' },
    Component: ProfileScreen,
  },
  {
    path: '/support',
    label: 'Техподдержка',
    icon: IconSupport,
    access: { kind: 'public' },
    Component: SupportScreen,
  },
  {
    path: '/admin',
    label: 'Управление',
    icon: IconSettings,
    access: { kind: 'adminOnly' },
    renderRoutes: () => (
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="dynamics" element={<AdminDynamics />} />
        <Route path="journal" element={<AdminJournal />} />
        <Route path="cabin" element={<AdminCabin />} />
        <Route path="kb" element={<AdminKb />} />
        <Route path="tasks" element={<AdminTasks />} />
        <Route path="calendar" element={<AdminCalendar />} />
        <Route path="stickers" element={<AdminStickers />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="plans" element={<AdminPlans />} />
        <Route path="feedback" element={<AdminFeedback />} />
        <Route path="survey" element={<AdminSurvey />} />
        <Route path="faq" element={<AdminFaq />} />
        <Route path="broadcast" element={<AdminBroadcast />} />
        <Route index element={<Navigate to="dynamics" replace />} />
      </Route>
    ),
  },
]
