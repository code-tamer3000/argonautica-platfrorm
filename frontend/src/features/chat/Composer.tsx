import { useRef, useState, type KeyboardEvent } from 'react'
import { useSendMessage } from '../../api/messages'
import { Button } from '../../components/Button'
import { wsClient } from '../../lib/wsClient'
import styles from './chat.module.css'

export function Composer({ roomId }: { roomId: number }) {
  const [text, setText] = useState('')
  const send = useSendMessage(roomId)
  const lastTyping = useRef(0)

  function submit() {
    const content = text.trim()
    if (!content || send.isPending) return
    setText('')
    send.mutate({ content })
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function onChange(value: string) {
    setText(value)
    const now = Date.now()
    if (now - lastTyping.current > 2500) {
      lastTyping.current = now
      wsClient.typing(roomId)
    }
  }

  return (
    <div className={styles.composer}>
      <textarea
        className={styles.composerInput}
        rows={1}
        placeholder="Сообщение…"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
      />
      <Button variant="gold" onClick={submit} disabled={!text.trim() || send.isPending}>
        Отправить
      </Button>
    </div>
  )
}
