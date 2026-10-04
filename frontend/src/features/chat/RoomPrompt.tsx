import { useState } from 'react'
import { useSendMessage } from '../../api/messages'
import { Button } from '../../components/Button'
import { toast } from '../../stores/toast'
import styles from './chat.module.css'

interface Props {
  roomId: number
  prompt: string
}

/**
 * Виджет-вопрос над композером комнаты (`rooms.prompt_text`, ARG-171), напр.
 * «О чём горит твой факел?» в чате Грота. Не дневник и не задание: свободный ответ
 * на тему, уходит ОБЫЧНЫМ сообщением в эту комнату (с заголовком-вопросом), так что
 * править/удалять его можно как любое своё сообщение. Свёрнут в одну строку, чтобы
 * не съедать экран в обычной переписке.
 */
export function RoomPrompt({ roomId, prompt }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const send = useSendMessage(roomId)

  function submit() {
    const answer = text.trim()
    if (!answer || send.isPending) return
    send.mutate(
      { content: `🔥 ${prompt}\n\n${answer}` },
      {
        onSuccess: () => {
          setText('')
          setOpen(false)
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Не удалось отправить', 'error'),
      },
    )
  }

  if (!open) {
    return (
      <div className={styles.promptBar}>
        <span className={styles.promptTitle}>🔥 {prompt}</span>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Ответить
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.promptBar}>
      <span className={styles.promptTitle}>🔥 {prompt}</span>
      <textarea
        className={styles.promptInput}
        rows={4}
        value={text}
        placeholder="Твой ответ…"
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className={styles.promptActions}>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={send.isPending}>
          Отмена
        </Button>
        <Button onClick={submit} disabled={send.isPending || !text.trim()}>
          {send.isPending ? 'Отправляем…' : 'Поделиться'}
        </Button>
      </div>
    </div>
  )
}
