import { useState } from 'react'
import { useAdminBroadcast } from '../../api/adminBroadcast'
import { useNotifPrefsOverview, type UserNotifPrefs } from '../../api/adminNotifPrefs'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

const KIND_CHIPS: { key: keyof UserNotifPrefs; label: string }[] = [
  { key: 'dm', label: 'ЛС' },
  { key: 'reply', label: 'Ответы' },
  { key: 'news', label: 'Новости' },
  { key: 'admin', label: 'Объявления' },
]

function PrefsOverview() {
  const { data, isLoading } = useNotifPrefsOverview()

  if (isLoading) {
    return (
      <div className="center" style={{ padding: 'var(--space-6)' }}>
        <Spinner size={20} />
      </div>
    )
  }
  const items = data?.items ?? []

  return (
    <div className={styles.list}>
      {items.map((u) => (
        <div key={u.user_id} className={styles.listItem}>
          <div className={styles.listItemMain}>
            <div>
              <div className={styles.listTitle}>{u.display_name}</div>
              <div className={styles.prefDevices}>
                {u.devices > 0 ? `устройств: ${u.devices}` : 'нет push-подписок'}
              </div>
            </div>
          </div>
          {u.push_enabled ? (
            <div className={styles.prefChips}>
              {KIND_CHIPS.map(({ key, label }) => (
                <span
                  key={key}
                  className={u[key] ? styles.prefChipOn : styles.prefChipOff}
                >
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <span className={styles.prefMuted}>push выключен</span>
          )}
        </div>
      ))}
      {items.length === 0 && <div className={styles.prefMuted}>Нет пользователей</div>}
    </div>
  )
}

// Рассылка уведомления всем пользователям: попадает в колокольчик каждому + native
// push тем, у кого включён тумблер «Объявления от администрации».
export function AdminBroadcast() {
  const broadcast = useAdminBroadcast()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const t = title.trim()
    const b = body.trim()
    if (!t || !b) {
      toast('Заполните заголовок и текст', 'error')
      return
    }
    broadcast.mutate(
      { title: t, body: b },
      {
        onSuccess: (res) => {
          toast(`Отправлено пользователям: ${res.recipients}`)
          setTitle('')
          setBody('')
        },
        onError: (err) =>
          toast(err instanceof Error ? err.message : 'Ошибка отправки', 'error'),
      },
    )
  }

  return (
    <div>
      <h2 className={styles.sectionTitle}>Отправить уведомление всем</h2>
      <form onSubmit={handleSubmit} className={styles.form}>
        <label className={styles.label}>
          Заголовок
          <input
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Напр. Плановые работы"
            required
          />
        </label>
        <label className={styles.label}>
          Текст
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="Текст уведомления…"
            required
          />
        </label>
        <div className={styles.formActions}>
          <Button type="submit" disabled={broadcast.isPending}>
            {broadcast.isPending ? 'Отправка…' : 'Отправить всем'}
          </Button>
        </div>
      </form>

      <h2 className={styles.sectionTitle}>У кого включены уведомления</h2>
      <PrefsOverview />
    </div>
  )
}
