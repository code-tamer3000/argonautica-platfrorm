import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useCreateKbComment, useDeleteKbComment, useKbComments } from '../../api/kb'
import { useUsersMap } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import { IconSend } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { useAuth } from '../auth/AuthContext'
import { toast } from '../../stores/toast'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import styles from './kb.module.css'

const commentTime = (iso: string) => format(new Date(iso), 'd MMM, HH:mm', { locale: ru })

export function KbComments({ itemId }: { itemId: number }) {
  const { data: comments, isLoading } = useKbComments(itemId)
  const users = useUsersMap()
  const { user } = useAuth()
  const create = useCreateKbComment(itemId)
  const del = useDeleteKbComment(itemId)
  const [text, setText] = useState('')

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const value = text.trim()
    if (!value || create.isPending) return
    create.mutate(value, {
      onSuccess: () => setText(''),
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
    })
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function remove(id: number) {
    if (!window.confirm('Удалить комментарий?')) return
    del.mutate(id, {
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Не удалось удалить', 'error'),
    })
  }

  const list = comments ?? []

  return (
    <section className={styles.comments}>
      <h2 className={styles.commentsTitle}>
        Комментарии{list.length > 0 && <span className={styles.commentsCount}> {list.length}</span>}
      </h2>

      <form className={styles.commentForm} onSubmit={submit}>
        <textarea
          className={styles.commentInput}
          placeholder="Написать комментарий…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={2}
        />
        {!!text.trim() && (
          <button
            className={styles.commentSend}
            type="submit"
            disabled={create.isPending}
            title="Отправить"
            aria-label="Отправить"
          >
            <IconSend size={18} />
          </button>
        )}
      </form>

      {isLoading && <div className="center" style={{ padding: 16 }}><Spinner size={18} /></div>}

      {!isLoading && list.length === 0 && (
        <div className={styles.commentsEmpty}>Пока нет комментариев. Будьте первым.</div>
      )}

      <ul className={styles.commentList}>
        {list.map((c) => {
          const author = users.get(c.author_id)
          const name = author?.display_name ?? `Участник #${c.author_id}`
          const canDelete = c.author_id === user?.id || user?.role === 'admin'
          return (
            <li key={c.id} className={styles.commentItem}>
              <Avatar name={name} url={author?.avatar_url} size={32} />
              <div className={styles.commentBody}>
                <div className={styles.commentHead}>
                  <span className={styles.commentAuthor}>{name}</span>
                  <span className={styles.commentTime}>{commentTime(c.created_at)}</span>
                  {canDelete && (
                    <button
                      className={styles.commentDelete}
                      onClick={() => remove(c.id)}
                      title="Удалить"
                      aria-label="Удалить комментарий"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className={styles.commentText}>{c.body}</div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
