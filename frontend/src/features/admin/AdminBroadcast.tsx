import { useState } from 'react'
import { useAdminBroadcast } from '../../api/adminBroadcast'
import { Button } from '../../components/Button'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

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
    </div>
  )
}
