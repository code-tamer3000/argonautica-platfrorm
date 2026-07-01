import type { PublicUserOut, RoomOut } from '../../lib/types'

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
