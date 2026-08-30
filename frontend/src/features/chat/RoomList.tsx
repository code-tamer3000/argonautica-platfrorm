import { useMemo, useState } from 'react'
import { useAdminUsersMap } from '../../api/admin'
import { usePlans } from '../../api/plans'
import { useRooms } from '../../api/rooms'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { BackButton } from '../../components/BackButton'
import { IconChat, IconDiary, IconPin, IconPlus, IconUsers } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import type { PublicUserOut, RoomOut } from '../../lib/types'
import { useUiStore } from '../../stores/ui'
import { useNavBadges } from '../app/useNavBadges'
import { useAuth } from '../auth/AuthContext'
import styles from './chat.module.css'
import { NewChatModal } from './NewChatModal'
import { NewGroupModal } from './NewGroupModal'
import { groupDiariesByPlan, roomAvatarUrl, roomTitle } from './util'

export type Tab = 'chats' | 'channels'

interface RoomButtonProps {
  r: RoomOut
  selectedId: number | null
  onSelect: (id: number) => void
  dmPeers: Record<number, number>
  online: number[]
  users: Map<number, PublicUserOut>
  pinned?: boolean
}

function RoomButton({ r, selectedId, onSelect, dmPeers, online, users, pinned }: RoomButtonProps) {
  const title = roomTitle(r, dmPeers, users)
  const peer = r.type === 'dm' ? (dmPeers[r.id] ?? r.peer_id) : undefined
  const isOnline = peer != null && online.includes(peer)
  return (
    <button
      className={`${styles.roomItem} ${selectedId === r.id ? styles.roomActive : ''}`}
      onClick={() => onSelect(r.id)}
    >
      <span className={styles.roomAvatarWrap}>
        <Avatar name={title} url={roomAvatarUrl(r, dmPeers, users)} square={r.type !== 'dm'} />
        {isOnline && <span className={styles.presenceDot} />}
      </span>
      <span className={styles.roomMain}>
        <span className={styles.roomTitle}>
          {r.type === 'channel' && !r.is_personal && !r.is_news ? '# ' : ''}
          {title}
          {pinned && <IconPin size={13} className={styles.roomPinIcon} />}
        </span>
        <span className={styles.roomSub}>{subLabel(r)}</span>
      </span>
      {r.unread_count > 0 && <span className={styles.unread}>{r.unread_count}</span>}
    </button>
  )
}

interface Props {
  tab: Tab
  onTabChange: (tab: Tab) => void
  selectedId: number | null
  onSelect: (id: number) => void
}

const subLabel = (r: RoomOut): string =>
  r.is_news ? 'Новостной канал' :
    r.is_personal ? 'Личный дневник' :
      r.type === 'channel' ? 'Дневник' : r.type === 'group' ? 'Группа' : 'Личный чат'

export function RoomList({ tab, onTabChange, selectedId, onSelect }: Props) {
  const { data: rooms, isLoading } = useRooms()
  const users = useUsersMap()
  const { user: me } = useAuth()
  const dmPeers = useUiStore((s) => s.dmPeers)
  const online = useUiStore((s) => s.online)
  // «Текущая экспедиция» (ARG-104): для admin список каналов виден БЕЗ серверного
  // фильтра (полный доступ, см. assert_room_access) — сужаем его же отображение до
  // выбранной экспедиции + общих каналов, тот же контекст, что в Задачи/КБ. Для
  // остального участника ничего не меняет: его rooms и так уже отфильтрованы
  // сервером. Выбирается ОДИН раз в /admin/expeditions, здесь только читаем.
  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const isAdmin = me?.role === 'admin'
  // Чужие личные дневники несут intake_id владельца НЕ на самой комнате (та колонка
  // у personal-комнат всегда NULL, см. docs/DATA_MODEL.md) — резолвим поток через
  // admin-ручку /api/admin/users. enabled=isAdmin: для обычного участника не стреляем
  // запросом вовсе (эндпоинт всё равно 403 для не-admin).
  const adminUsers = useAdminUsersMap(isAdmin)
  const { data: plans = [] } = usePlans()
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'chat' | 'group' | null>(null)
  const badges = useNavBadges()

  const { dms, groups, pinnedChannels, diaryGroups, otherChannels } = useMemo(() => {
    const list = rooms ?? []
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? list.filter((r) => roomTitle(r, dmPeers, users).toLowerCase().includes(needle))
      : list
    // Новостной канал вынесен в верхнеуровневую кнопку «Новости» (см. AppShell) —
    // из списка каналов его исключаем, чтобы не дублировать.
    let channels = filtered.filter((r) => r.type === 'channel' && !r.is_news)
    const applyIntakeFilter = isAdmin && currentIntakeId != null
    if (applyIntakeFilter) {
      channels = channels.filter((r) => {
        if (r.is_personal) {
          // Свой дневник виден всегда — иначе admin потерял бы «Закреплённые».
          if (r.created_by === me?.id) return true
          const ownerIntakeId = adminUsers.get(r.created_by)?.intake_id
          return ownerIntakeId == null || ownerIntakeId === currentIntakeId
        }
        return r.intake_id == null || r.intake_id === currentIntakeId
      })
    }

    // Закреплённые сверху: собственный личный канал.
    const mine = channels.find((r) => r.is_personal && r.created_by === me?.id)
    const pinnedIds = new Set([mine?.id].filter((x): x is number => x != null))
    const pinned: RoomOut[] = []
    if (mine) pinned.push(mine)

    let dms = filtered.filter((r) => r.type === 'dm')
    let groups = filtered.filter((r) => r.type === 'group')
    if (applyIntakeFilter) {
      // dm/group не несут intake_id на самой комнате (гейтятся явным членством,
      // не потоком, см. docs/ROOMS.md) — но admin здесь смотрит на них с точки
      // зрения «что относится к этой экспедиции», поэтому резолвим поток стороны:
      // для dm — собеседник, для группы — создатель.
      dms = dms.filter((r) => {
        const peerId = dmPeers[r.id] ?? r.peer_id
        if (peerId == null) return true
        const peerIntakeId = adminUsers.get(peerId)?.intake_id
        return peerIntakeId == null || peerIntakeId === currentIntakeId
      })
      groups = groups.filter((r) => {
        const ownerIntakeId = adminUsers.get(r.created_by)?.intake_id
        return ownerIntakeId == null || ownerIntakeId === currentIntakeId
      })
    }

    // «Все дневники» делится на группы по тарифу владельца (игроки/спецотряд/
    // око и т.п.) — личные дневники группируются, обычные «Дневник»-каналы
    // (не personal, редкий случай) тарифа не несут и остаются отдельным хвостом.
    const others = channels.filter((r) => !pinnedIds.has(r.id))
    const otherPersonal = others.filter((r) => r.is_personal)
    const otherRegular = others.filter((r) => !r.is_personal)

    return {
      dms,
      groups,
      pinnedChannels: pinned,
      diaryGroups: groupDiariesByPlan(otherPersonal, plans),
      otherChannels: otherRegular,
    }
  }, [rooms, q, dmPeers, users, me?.id, isAdmin, currentIntakeId, adminUsers, plans])

  const chatsEmpty = dms.length === 0 && groups.length === 0
  const channelsEmpty =
    pinnedChannels.length === 0 && diaryGroups.length === 0 && otherChannels.length === 0

  return (
    <aside className={styles.list}>
      <div className={styles.tabs}>
        {/* Один общий индикатор, «пробегающий» между вкладками Чаты↔Дневники.
            Вкладок ровно две (по 50%), поэтому X = 0% или 100% ширины глайдера. */}
        <span
          className={styles.tabGlider}
          style={{ transform: `translateX(${tab === 'chats' ? '0%' : '100%'})` }}
          aria-hidden
        />
        <button
          className={`${styles.tab} ${tab === 'chats' ? styles.tabActive : ''}`}
          onClick={() => onTabChange('chats')}
        >
          <IconChat size={16} /> Чаты
          {badges.chats > 0 && <span className={styles.tabBadge}>{badges.chats > 99 ? '99+' : badges.chats}</span>}
        </button>
        <button
          className={`${styles.tab} ${tab === 'channels' ? styles.tabActive : ''}`}
          onClick={() => onTabChange('channels')}
        >
          <IconDiary size={16} /> Дневники
          {badges.channels > 0 && <span className={styles.tabBadge}>{badges.channels > 99 ? '99+' : badges.channels}</span>}
        </button>
      </div>

      <div className={styles.listHead}>
        {/* Выпускнику новые чаты/группы не заводим: писать в них он всё равно
            не сможет (Рубка у него только на чтение). */}
        {tab === 'chats' && !me?.graduated_at && (
          <div className={styles.headActions}>
            <button className={styles.headBtn} onClick={() => setModal('chat')}>
              <IconPlus size={16} /> Новый чат
            </button>
            {me?.can_create_groups && (
              <button className={styles.headBtn} onClick={() => setModal('group')}>
                <IconUsers size={16} /> Группа
              </button>
            )}
          </div>
        )}
        {/* «Назад» в строке поиска: полоса вкладок держит глайдер ровно на две
            кнопки (см. .tabGlider), третий элемент там сбил бы расчёт. */}
        <div className={styles.searchRow}>
          <BackButton />
          <input
            className={styles.search}
            placeholder="Поиск"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {modal === 'chat' && (
        <NewChatModal
          onClose={() => setModal(null)}
          onOpenDm={(id) => {
            setModal(null)
            onSelect(id)
          }}
        />
      )}
      {modal === 'group' && (
        <NewGroupModal
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null)
            onSelect(id)
          }}
        />
      )}

      <div key={tab} className={styles.rooms}>
        {isLoading && (
          <div className="center" style={{ padding: 24 }}>
            <Spinner />
          </div>
        )}

        {tab === 'chats' && (
          <>
            {rooms && chatsEmpty && (
              <div className="muted" style={{ padding: 16, fontSize: 14 }}>Чатов нет</div>
            )}
            {dms.length > 0 && (
              <>
                <div className={styles.sectionHeader}>Чаты</div>
                {dms.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
              </>
            )}
            {groups.length > 0 && (
              <>
                <div className={styles.sectionHeader}>Группы</div>
                {groups.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
              </>
            )}
          </>
        )}

        {tab === 'channels' && (
          <>
            {rooms && channelsEmpty && (
              <div className="muted" style={{ padding: 16, fontSize: 14 }}>Дневников нет</div>
            )}
            {pinnedChannels.length > 0 && (
              <>
                <div className={styles.sectionHeader}>Закреплённые</div>
                {pinnedChannels.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} pinned />)}
              </>
            )}
            {diaryGroups.map((group) => (
              <div key={group.key}>
                <div className={styles.sectionHeader}>{group.label}</div>
                {group.rooms.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
              </div>
            ))}
            {otherChannels.length > 0 && (
              <>
                <div className={styles.sectionHeader}>Каналы</div>
                {otherChannels.map((r) => <RoomButton key={r.id} r={r} selectedId={selectedId} onSelect={onSelect} dmPeers={dmPeers} online={online} users={users} />)}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
