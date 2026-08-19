import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route } from 'react-router-dom'
import { useRooms } from '../../api/rooms'
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
import type { NavBadges } from './useNavBadges'
import { useAccessContext, type Access } from './RequireAccess'

// Раздел «Генные ключи» тянет 64 markdown-файла — держим его в отдельном чанке,
// чтобы не раздувать основной бандл (грузится только при заходе в раздел).
const GeneKeysScreen = lazy(() =>
  import('../genkeys/GeneKeysScreen').then((m) => ({ default: m.GeneKeysScreen })),
)
const KbBookReader = lazy(() =>
  import('../kb/book/KbBookReader').then((m) => ({ default: m.KbBookReader })),
)
// Админка: 13 экранов + их статические импорты — заметный вес, который не нужен
// никому, кроме админа (наблюдатель её вообще не видит). Один lazy-чанк на всё
// поддерево, а не дробление на 13 маленьких — см. AdminRoutes.tsx.
const AdminRoutes = lazy(() =>
  import('../admin/AdminRoutes').then((m) => ({ default: m.AdminRoutes })),
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

// «/» никогда не рендерит контент сам — только решает, куда увести: обычного
// пользователя в Рубку, наблюдателя — на его домашние материалы.
function RootRedirect() {
  const { isObserver } = useAccessContext()
  return <Navigate to={isObserver ? '/kb' : '/chats'} replace />
}

// «/news» резолвит новостную комнату и уводит на её реальный адрес — сегмент
// зависит от типа комнаты (канал живёт в /diaries, всё остальное — в /chats).
function NewsRedirect() {
  const { data: rooms } = useRooms()
  if (!rooms) return <div className="center grow"><Spinner /></div>
  const news = rooms.find((r) => r.is_news)
  if (!news) return <Navigate to="/chats" replace />
  const segment = news.type === 'channel' ? 'diaries' : 'chats'
  return <Navigate to={`/${segment}/${news.id}`} replace />
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
  /** Маршрут существует, но не показывается в наве — редирект-переходники («/»). */
  hidden?: boolean
  /**
   * Пункт нава активен на нескольких несмежных путях (Рубка = /chats* и /diaries*
   * — Чаты/Дневники визуально один раздел, см. ARG-99 «навигацию не меняем»).
   * Если задано, заменяет обычное сопоставление NavLink.
   */
  isNavActive?: (pathname: string) => boolean
  /** Обычный случай: один компонент на path, плюс соседние маршруты без своего пункта в наве. */
  Component?: ComponentType
  children?: RouteChild[]
  /**
   * Спецслучай — свой вложенный <Route>-поддерева со своим layout/<Outlet/>.
   * Сейчас только у «/admin»: её 13 подмаршрутов (ARG-97 их не трогает) живут в
   * отдельном lazy-чанке (AdminRoutes.tsx), сюда попадает лишь Suspense-обёртка.
   */
  renderRoutes?: () => ReactNode
}

export const routes: RouteEntry[] = [
  {
    path: '/',
    label: 'Рубка',
    icon: IconChat,
    access: { kind: 'public' },
    hidden: true,
    Component: RootRedirect,
  },
  {
    path: '/chats',
    label: 'Рубка',
    icon: IconChat,
    access: { kind: 'observerBlocked' },
    badgeKey: 'rubka',
    isNavActive: (pathname) => pathname.startsWith('/chats') || pathname.startsWith('/diaries'),
    Component: () => <ChatLayout tab="chats" />,
    children: [
      { path: '/chats/:roomId', Component: () => <ChatLayout tab="chats" /> },
      { path: '/diaries', Component: () => <ChatLayout tab="channels" /> },
      { path: '/diaries/:roomId', Component: () => <ChatLayout tab="channels" /> },
    ],
  },
  {
    path: '/news',
    label: 'Новости',
    icon: IconNews,
    access: { kind: 'observerBlocked' },
    badgeKey: 'news',
    Component: NewsRedirect,
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
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<div className="center grow"><Spinner /></div>}>
            <AdminRoutes />
          </Suspense>
        }
      />
    ),
  },
]
