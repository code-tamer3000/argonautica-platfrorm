import { groupByPlan } from '../../lib/planGroups'
import type { PlanPublicOut, PublicUserOut, RoomOut } from '../../lib/types'

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
