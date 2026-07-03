import { useEffect, useRef, useState } from 'react'
import { useMarkNotificationsRead, useNotifications } from '../../api/notifications'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconAlert, IconBell } from '../../components/icons'
import { timeHM } from '../../lib/format'
import type { NotificationKind, NotificationOut } from '../../lib/types'
import { useOpenNotification } from './useOpenNotification'
import styles from './notifications.module.css'

const KIND_LABEL: Record<NotificationKind, string> = {
  dm: 'написал(а) вам',
  reply: 'ответил(а) на ваше сообщение',
  news: 'новый пост в новостях',
  journal_missed: '',
}

const KIND_FALLBACK: Record<NotificationKind, string> = {
  dm: 'Новое сообщение',
  reply: 'Новый ответ',
  news: 'Смотреть в новостях',
  journal_missed: 'День дневника не закрыт',
}

// Заголовок системного уведомления (без автора).
const SYSTEM_TITLE: Partial<Record<NotificationKind, string>> = {
  journal_missed: 'Дневник',
}

export function NotificationBell() {
  const { data } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const users = useUsersMap()
  const openTarget = useOpenNotification()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Закрытие по клику вне панели.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const items = data?.items ?? []
  const unread = data?.unread_count ?? 0

  function onItem(n: NotificationOut) {
    markRead.mutate(n.id)
    setOpen(false)
    openTarget(n)
  }

  return (
    <div className={styles.bellWrap} ref={ref}>
      <button
        className={styles.bellBtn}
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
      >
        <IconBell size={20} />
        {unread > 0 && (
          <span className={styles.bellBadge}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span>Уведомления</span>
            {unread > 0 && (
              <button className={styles.markAll} onClick={() => markRead.mutate(undefined)}>
                Прочитать все
              </button>
            )}
          </div>
          <div className={styles.panelList}>
            {items.length === 0 && <div className={styles.empty}>Пока пусто</div>}
            {items.map((n) => {
              const system = n.actor_id == null
              const title = system ? (SYSTEM_TITLE[n.kind] ?? 'Система') : n.actor_name
              return (
                <button
                  key={n.id}
                  className={`${styles.item} ${n.read_at ? '' : styles.itemUnread}`}
                  onClick={() => onItem(n)}
                >
                  {system ? (
                    <span className={styles.systemIcon}><IconAlert size={20} /></span>
                  ) : (
                    <Avatar name={n.actor_name ?? '?'} url={users.get(n.actor_id!)?.avatar_url} size={34} />
                  )}
                  <div className={styles.itemBody}>
                    <div className={styles.itemTitle}>
                      <span className={styles.itemActor}>{title}</span>{' '}
                      {KIND_LABEL[n.kind] && <span className={styles.itemKind}>{KIND_LABEL[n.kind]}</span>}
                    </div>
                    <div className={styles.itemText}>{n.preview ?? KIND_FALLBACK[n.kind]}</div>
                  </div>
                  <span className={styles.itemTime}>{timeHM(n.created_at)}</span>
                  {!n.read_at && <span className={styles.itemDot} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
