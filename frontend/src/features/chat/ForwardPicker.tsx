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
 *
 * Дополнительно сужен до «текущего потока» (`currentIntakeId`): dm-чаты фильтруются
 * по `peer_intake_id`, новостные каналы (admin) — по `intake_id` самой комнаты —
 * иначе и admin-оверсайт, и обычный участник, переходивший между потоками, видят
 * в пикере людей/каналы не своего текущего потока (ARG-104 news per intake, dm
 * членство не завязано на intake).
 */
export function ForwardPicker({ onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const { user } = useAuth()
  const { data: rooms, isLoading } = useRooms()
  const users = useUsersMap()
  const dmPeers = useUiStore((s) => s.dmPeers)
  // Сужаем до «текущего потока» — иначе и admin (новостной канал КАЖДОГО потока,
  // по одному на intake, ARG-104), и обычный участник, переходивший между потоками
  // (dm остаются от старого потока, доступ по членству не завязан на intake),
  // видят в пикере лишний шум: чужие новости / людей не своего текущего потока.
  // Admin — тот же контекст «текущий поток», что и Задачи/КБ/Чаты в админке
  // (см. RoomList.tsx); обычный участник — просто свой АКТИВНЫЙ intake_id, без
  // отдельного переключателя (у него и так только один «текущий»).
  const adminCurrentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const isAdmin = user?.role === 'admin'
  const currentIntakeId = isAdmin ? adminCurrentIntakeId : user?.intake_id ?? null

  const needle = q.trim().toLowerCase()

  const groups = useMemo<Group[]>(() => {
    const list = (rooms ?? []).filter((r) => canPostTopLevel(r, user))
    const matches = (r: RoomOut) =>
      !needle || roomTitle(r, dmPeers, users).toLowerCase().includes(needle)
    let dms = list.filter((r) => r.type === 'dm' && matches(r))
    if (currentIntakeId != null) {
      // peer_intake_id отсутствует (историческая запись без набора) — не прячем.
      dms = dms.filter((r) => r.peer_intake_id == null || r.peer_intake_id === currentIntakeId)
    }
    const groupRooms = list.filter((r) => r.type === 'group' && matches(r))
    const channels = list.filter((r) => r.type === 'channel' && !r.is_news && matches(r))
    let news = list.filter((r) => r.is_news && matches(r))
    if (isAdmin && currentIntakeId != null) {
      news = news.filter((r) => r.intake_id === currentIntakeId)
    }
    const result: Group[] = []
    if (dms.length) result.push({ key: 'dm', title: 'Личные чаты', rooms: dms })
    if (groupRooms.length) result.push({ key: 'group', title: 'Группы', rooms: groupRooms })
    if (channels.length) result.push({ key: 'channel', title: 'Дневники', rooms: channels })
    if (news.length) result.push({ key: 'news', title: 'Новости', rooms: news })
    return result
  }, [rooms, user, needle, dmPeers, users, isAdmin, currentIntakeId])

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
