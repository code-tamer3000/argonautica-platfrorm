import { differenceInCalendarDays } from 'date-fns'
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Navigate, Route, useParams } from 'react-router-dom'
import { useRooms } from '../../api/rooms'
import { useAuth } from '../auth/AuthContext'
import {
  IconBook,
  IconCalendar,
  IconChat,
  IconDiary,
  IconGenkeys,
  IconMoon,
  IconNews,
  IconSettings,
  IconSupport,
  IconTasks,
  IconUser,
} from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { useUiStore } from '../../stores/ui'
import { ChatLayout } from '../chat/ChatLayout'
import { CalendarView } from '../calendar/CalendarView'
import { DashboardScreen } from '../dashboard/DashboardScreen'
import { CohortPending } from './CohortPending'
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

// Открытая по этому маршруту комната — новостная? «/news» резолвится именно в
// /chats/:roomId или /diaries/:roomId (см. NewsRedirect) — гейт ниже должен отличать
// её от обычной комнаты того же маршрута, иначе задевает и новости (не входят
// в «Рубку и Календарь» из границ задачи — новость и есть текст поп-апа, её
// нельзя терять за той же заглушкой).
function useIsNewsRoom(): boolean {
  const { roomId } = useParams<{ roomId?: string }>()
  const { data: rooms } = useRooms()
  if (!roomId || !rooms) return false
  return !!rooms.find((r) => r.id === Number(roomId))?.is_news
}

// Набор ещё не начался (ARG-106): подменяет Рубку/Календарь заглушкой «до старта
// осталось N дней», пока `today < intake.starts_on`. По календарным дням, без учёта
// времени старта — см. Assumptions задачи. Новостной канал — исключение (см.
// useIsNewsRoom), но список комнат и переключатель Чаты/Дневники вокруг нужного
// сообщения всё равно ведут в закрытую Рубку — `makeComponent` получает `newsOnly`
// и прячет их (ChatLayout.hideRoomList), оставляя только саму новость. Гейт не
// влияет на видимость пункта нава (isRouteVisible/Access) — раздел просто
// открывается сам в день старта.
function withCohortGate(makeComponent: (opts: { newsOnly: boolean }) => ReactNode) {
  return function CohortGated() {
    const { user } = useAuth()
    const isNewsRoom = useIsNewsRoom()
    const startsOn = user?.intake_starts_on ?? null
    const pending = !!startsOn && differenceInCalendarDays(new Date(startsOn), new Date()) > 0
    if (pending && !isNewsRoom) return <CohortPending startsOn={startsOn!} />
    return makeComponent({ newsOnly: pending && isNewsRoom })
  }
}

// «/» — Круг Экспедиции для обычного участника; наблюдателя уводит на его
// домашние материалы (Динамика/Задачи/Круг ему не положены — require_participant
// на /api/dashboard всё равно ответит 403, но заглядывать в наблюдателя незачем).
function RootScreen() {
  const { isObserver } = useAccessContext()
  if (isObserver) return <Navigate to="/kb" replace />
  return <DashboardScreen />
}

// «/news» резолвит новостную комнату и уводит на её реальный адрес — сегмент
// зависит от типа комнаты (канал живёт в /diaries, всё остальное — в /chats).
// Новостной канал больше не singleton (ARG-104) — один на поток. Для admin, у
// которого выбран «текущий поток» (см. AdminLayout/stores/ui.ts), резолвим ИМЕННО
// его новости; иначе (обычный участник — его rooms и так только его поток, или
// admin без выбора) берём первый найденный.
function NewsRedirect() {
  const { data: rooms } = useRooms()
  const { isAdmin } = useAccessContext()
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  if (!rooms) return <div className="center grow"><Spinner /></div>
  const news = (isAdmin && currentIntakeId != null
    ? rooms.find((r) => r.is_news && r.intake_id === currentIntakeId)
    : undefined) ?? rooms.find((r) => r.is_news)
  if (!news) return <Navigate to="/chats" replace />
  const segment = news.type === 'channel' ? 'diaries' : 'chats'
  return <Navigate to={`/${segment}/${news.id}`} replace />
}

// id открытой комнаты из /chats/:id или /diaries/:id, иначе null.
const openRoomIdFrom = (pathname: string): number | null => {
  const m = /^\/(?:chats|diaries)\/(\d+)$/.exec(pathname)
  return m ? Number(m[1]) : null
}

export interface NavActiveContext {
  pathname: string
  // id новостной комнаты (см. NewsRedirect) — «/news» резолвится в /chats/:id
  // или /diaries/:id, и без этого её адрес неотличим от обычной комнаты того
  // же раздела: подсвечивались бы одновременно «Рубка»/«Дневники» и «Новости».
  newsRoomId: number | null
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
   * — Чаты/Дневники визуально один раздел, см. ARG-99 «навигацию не меняем»),
   * либо требует различить открытую новостную комнату от обычной (Новости).
   * Если задано, заменяет обычное сопоставление NavLink.
   */
  isNavActive?: (ctx: NavActiveContext) => boolean
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
    label: 'Главная',
    icon: IconMoon,
    end: true,
    access: { kind: 'public' },
    Component: RootScreen,
  },
  {
    path: '/chats',
    label: 'Рубка',
    icon: IconChat,
    access: { kind: 'observerBlocked' },
    badgeKey: 'rubka',
    isNavActive: ({ pathname, newsRoomId }) =>
      (pathname.startsWith('/chats') || pathname.startsWith('/diaries')) &&
      !(newsRoomId != null && openRoomIdFrom(pathname) === newsRoomId),
    Component: withCohortGate(({ newsOnly }) => <ChatLayout tab="chats" hideRoomList={newsOnly} />),
    children: [
      {
        path: '/chats/:roomId',
        Component: withCohortGate(({ newsOnly }) => <ChatLayout tab="chats" hideRoomList={newsOnly} />),
      },
      {
        path: '/diaries',
        Component: withCohortGate(({ newsOnly }) => <ChatLayout tab="channels" hideRoomList={newsOnly} />),
      },
      {
        path: '/diaries/:roomId',
        Component: withCohortGate(({ newsOnly }) => <ChatLayout tab="channels" hideRoomList={newsOnly} />),
      },
    ],
  },
  {
    path: '/news',
    label: 'Новости',
    icon: IconNews,
    access: { kind: 'observerBlocked' },
    badgeKey: 'news',
    isNavActive: ({ pathname, newsRoomId }) =>
      newsRoomId != null && openRoomIdFrom(pathname) === newsRoomId,
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
    Component: withCohortGate(() => <CalendarView />),
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
