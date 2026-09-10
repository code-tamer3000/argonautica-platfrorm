import { Fragment, useMemo, useState } from 'react'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { RoomOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useAuth } from '../auth/AuthContext'
import styles from './chat.module.css'
import { canPostTopLevel, roomAvatarUrl, roomSubLabel, roomTitle } from './util'

interface Group {
  key: string
  title: string
  rooms: RoomOut[]
}

interface Props {
  onPick: (roomId: number) => void
  onClose: () => void
}

/**
 * Пикер комнаты для пересылки сообщения. Список — те же `useRooms()`, что и в
 * RoomList/ChatPane, отфильтрованные `canPostTopLevel` (клиентское зеркало
 * серверного `assert_can_post` — куда реально можно отправить верхнеуровневое
 * сообщение). Сервер перепроверяет право на цель авторитетно при самой пересылке
 * (`POST .../repost?target_room_id=`), так что фильтр здесь — только UX, не граница
 * доступа.
 */
export function ForwardPicker({ onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const { user } = useAuth()
  const { data: rooms, isLoading } = useRooms()
  const users = useUsersMap()
  const dmPeers = useUiStore((s) => s.dmPeers)

  const needle = q.trim().toLowerCase()

  const groups = useMemo<Group[]>(() => {
    const list = (rooms ?? []).filter((r) => canPostTopLevel(r, user))
    const matches = (r: RoomOut) =>
      !needle || roomTitle(r, dmPeers, users).toLowerCase().includes(needle)
    const dms = list.filter((r) => r.type === 'dm' && matches(r))
    const groupRooms = list.filter((r) => r.type === 'group' && matches(r))
    const channels = list.filter((r) => r.type === 'channel' && !r.is_news && matches(r))
    const news = list.filter((r) => r.is_news && matches(r))
    const result: Group[] = []
    if (dms.length) result.push({ key: 'dm', title: 'Личные чаты', rooms: dms })
    if (groupRooms.length) result.push({ key: 'group', title: 'Группы', rooms: groupRooms })
    if (channels.length) result.push({ key: 'channel', title: 'Дневники', rooms: channels })
    if (news.length) result.push({ key: 'news', title: 'Новости', rooms: news })
    return result
  }, [rooms, user, needle, dmPeers, users])

  const empty = !isLoading && groups.length === 0

  return (
    <Modal title="Переслать" onClose={onClose}>
      <input
        className={styles.search}
        placeholder="Поиск чата"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <div className={styles.refList}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}
        {empty && (
          <div className="muted" style={{ padding: 16, fontSize: 14 }}>
            Некуда переслать
          </div>
        )}
        {groups.map((group) => (
          <Fragment key={group.key}>
            <div className={styles.refCategoryTitle}>{group.title}</div>
            {group.rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className={styles.refRow}
                onClick={() => onPick(r.id)}
              >
                <Avatar
                  name={roomTitle(r, dmPeers, users)}
                  url={roomAvatarUrl(r, dmPeers, users)}
                  square={r.type !== 'dm'}
                  size={28}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className={styles.refRowTitle} style={{ display: 'block' }}>
                    {roomTitle(r, dmPeers, users)}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {roomSubLabel(r)}
                  </span>
                </span>
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </Modal>
  )
}
