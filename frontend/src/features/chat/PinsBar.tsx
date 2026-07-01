import { useState } from 'react'
import { usePins } from '../../api/pins'
import { useUsersMap } from '../../api/users'
import { IconPin } from '../../components/icons'
import styles from './chat.module.css'

interface Props {
  roomId: number
  onOpenList: () => void
  onNavigate?: (msgId: number) => void
}

function preview(content: string | null, stickerId: number | null, hasAtt: boolean): string {
  if (content) return content
  if (stickerId != null) return '[стикер]'
  if (hasAtt) return '[вложение]'
  return '[сообщение]'
}

/** Тонкая полоса закрепа под шапкой (как в Telegram). Всегда видна, если есть пины.
 *  Несколько пинов — циклическое переключение по клику; клик навигирует к сообщению;
 *  кнопка справа открывает полный список. */
export function PinsBar({ roomId, onOpenList, onNavigate }: Props) {
  const { data } = usePins(roomId, true)
  const users = useUsersMap()
  const [idx, setIdx] = useState(0)

  if (!data || data.length === 0) return null

  const pos = idx % data.length
  const pin = data[pos]
  const author = users.get(pin.message.sender_id)
  const name = author?.display_name ?? `Участник #${pin.message.sender_id}`
  const multiple = data.length > 1

  return (
    <div className={styles.pinsBar}>
      <span className={styles.pinsBarIcon}><IconPin size={16} /></span>
      <button
        type="button"
        className={styles.pinsBarBody}
        onClick={() => {
          onNavigate?.(pin.message.id)
          if (multiple) setIdx((i) => i + 1)
        }}
        title="Перейти к сообщению"
      >
        <span className={styles.pinsBarLabel}>
          Закреплённое{multiple ? ` · ${pos + 1}/${data.length}` : ''}
        </span>
        <span className={styles.pinsBarText}>
          <span className={styles.pinsBarAuthor}>{name}: </span>
          {preview(pin.message.content, pin.message.sticker_id, pin.message.attachment_ids.length > 0)}
        </span>
      </button>
      <button
        type="button"
        className={styles.pinsBarMore}
        onClick={onOpenList}
        title="Все закреплённые"
        aria-label="Все закреплённые"
      >
        Все
      </button>
    </div>
  )
}
