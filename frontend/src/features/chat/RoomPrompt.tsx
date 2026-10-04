import { Button } from '../../components/Button'
import { useUiStore } from '../../stores/ui'
import styles from './chat.module.css'

interface Props {
  roomId: number
  prompt: string
}

/**
 * Виджет-вопрос над композером комнаты (`rooms.prompt_text`, ARG-171), напр.
 * «О чём горит твой факел?» в чате Грота. Не дневник и не задание. «Ответить»
 * не открывает свой ввод, а «цепляет» вопрос к РОДНОМУ композеру (pendingPrompt):
 * плашка с вопросом и крестиком появляется над полем ввода, следующее сообщение
 * уходит с заголовком-вопросом; крестик снимает вопрос — и композер снова обычный.
 * Пока вопрос прицеплен, эта строка скрыта.
 */
export function RoomPrompt({ roomId, prompt }: Props) {
  const active = useUiStore((s) => s.pendingPrompt?.roomId === roomId)
  const setPendingPrompt = useUiStore((s) => s.setPendingPrompt)
  if (active) return null

  return (
    <div className={styles.promptBar}>
      <span className={styles.promptTitle}>🔥 {prompt}</span>
      <Button variant="outline" onClick={() => setPendingPrompt({ roomId, text: prompt })}>
        Ответить
      </Button>
    </div>
  )
}
