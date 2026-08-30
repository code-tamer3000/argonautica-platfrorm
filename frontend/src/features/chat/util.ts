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

const NO_PLAN_KEY = 'none'

/**
 * Группировка чужих личных дневников по тарифу владельца («Игроки»/«Спецотряд»/
 * «Око» — см. RoomOut.owner_plan_id/owner_plan_name). Порядок групп — как в
 * `usePlans()` (по цене, тот же порядок, что в админке); «Без тарифа» — всегда
 * последней. Тариф, ставший неактивным (выпал из `plans`), всё равно попадает в
 * свою группу — имя берём из самой комнаты (denormalized), просто без стабильной
 * позиции в сортировке (падает в конец, перед «Без тарифа»).
 */
export function groupDiariesByPlan(rooms: RoomOut[], plans: PlanPublicOut[]): DiaryPlanGroup[] {
  const order = new Map(plans.map((p, i) => [p.id, i]))
  const buckets = new Map<string, RoomOut[]>()
  for (const room of rooms) {
    const key = room.owner_plan_id != null ? String(room.owner_plan_id) : NO_PLAN_KEY
    const list = buckets.get(key)
    if (list) list.push(room)
    else buckets.set(key, [room])
  }
  return [...buckets.entries()]
    .map(([key, groupRooms]) => ({
      key,
      label:
        key === NO_PLAN_KEY
          ? 'Без тарифа'
          : (groupRooms[0]?.owner_plan_name ?? plans.find((p) => String(p.id) === key)?.name ?? 'Тариф'),
      rooms: groupRooms,
    }))
    .sort((a, b) => {
      if (a.key === NO_PLAN_KEY) return 1
      if (b.key === NO_PLAN_KEY) return -1
      return (order.get(Number(a.key)) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(Number(b.key)) ?? Number.MAX_SAFE_INTEGER)
    })
}
