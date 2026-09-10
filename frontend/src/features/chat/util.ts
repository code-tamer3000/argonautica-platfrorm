import { groupByPlan } from '../../lib/planGroups'
import type { PlanPublicOut, PublicUserOut, RoomOut, UserOut } from '../../lib/types'

export function roomTitle(
  room: RoomOut,
  dmPeers: Record<number, number>,
  users: Map<number, PublicUserOut>,
): string {
  if (room.type === 'dm') {
    const peerId = dmPeers[room.id] ?? room.peer_id
    const u = peerId != null ? users.get(peerId) : undefined
    return u ? u.display_name : 'Личный чат'
  }
  return room.name ?? 'Без названия'
}

export function roomAvatarUrl(
  room: RoomOut,
  dmPeers: Record<number, number>,
  users: Map<number, PublicUserOut>,
): string | null {
  if (room.type === 'dm') {
    const peerId = dmPeers[room.id] ?? room.peer_id
    return (peerId != null ? users.get(peerId)?.avatar_url : null) ?? null
  }
  return room.avatar_url
}

export const roomPrefix = (room: RoomOut): string =>
  room.type === 'channel' ? '# ' : ''

export const roomSubLabel = (room: RoomOut): string =>
  room.is_news ? 'Новостной канал' :
    room.is_personal ? 'Личный дневник' :
      room.type === 'channel' ? 'Дневник' : room.type === 'group' ? 'Группа' : 'Личный чат'

/**
 * Может ли user отправить ВЕРХНЕУРОВНЕВОЕ сообщение в room — клиентское зеркало
 * серверного `assert_can_post` (backend/app/api/messages.py), используется только
 * для UX-фильтра (чей чат показать в пикере пересылки, ForwardPicker.tsx): сервер
 * всё равно перепроверит то же самое авторитетно при самой пересылке.
 */
export function canPostTopLevel(room: RoomOut, user: UserOut | null | undefined): boolean {
  if (!user || user.graduated_at) return false
  if (room.dm_write_locked) return false
  if (room.is_personal && room.created_by !== user.id) return false
  if (room.is_news && user.role !== 'admin') return false
  return true
}

export interface DiaryPlanGroup {
  key: string
  label: string
  rooms: RoomOut[]
}

// Sentinel id админ-владельца в RoomOut.owner_plan_id — зеркало
// `_ADMIN_OWNER_PLAN_ID` (backend/app/api/rooms.py), не настоящий plans.id.
const ADMIN_OWNER_PLAN_KEY = '-1'

/**
 * Группировка чужих личных дневников по тарифу владельца («Игроки»/«Спецотряд»/
 * «Око» — см. RoomOut.owner_plan_id/owner_plan_name). Порядок групп и «Без
 * тарифа» в конце — общие для всего приложения, см. lib/planGroups — секцию
 * «Админ» (sentinel-id) выносим первой: дневники видны только тем, кому явно
 * открыт `diary_public`, и в этом случае они должны бросаться в глаза сразу.
 */
export function groupDiariesByPlan(rooms: RoomOut[], plans: PlanPublicOut[]): DiaryPlanGroup[] {
  const groups = groupByPlan(rooms, plans, (room) => ({
    id: room.owner_plan_id ?? null,
    name: room.owner_plan_name ?? null,
  })).map(({ key, label, items }) => ({ key, label, rooms: items }))
  const adminIdx = groups.findIndex((g) => g.key === ADMIN_OWNER_PLAN_KEY)
  if (adminIdx > 0) {
    const [admin] = groups.splice(adminIdx, 1)
    groups.unshift(admin)
  }
  return groups
}
