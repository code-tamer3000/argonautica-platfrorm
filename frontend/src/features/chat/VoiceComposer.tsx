import { useEffect, useState } from 'react'
import { IconClose, IconSend } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { VoicePlayer } from '../../components/VoicePlayer'
import { preparePendingVoice, type PendingUpload } from '../../lib/mediaUpload'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import { toast } from '../../stores/toast'
import { VoicePill } from './VoicePill'
import styles from './chat.module.css'

interface Props {
  /**
   * Запись готова → отдаём сырой описатель (PendingUpload, БЕЗ заливки). Родитель сам
   * решает, слать через outbox (верхний уровень, переживает офлайн) или залить
   * синхронно (дневник/тред). Заливать здесь нельзя — иначе офлайн терял бы голосовое.
   */
  onSend: (pending: PendingUpload) => void
  /** Сообщает родителю, идёт ли запись/превью — по нему он прячет поле ввода. */
  onActiveChange?: (active: boolean) => void
  disabled?: boolean
}

/**
 * Запись и предпрослушивание голосового в основном композере и треде.
 * Маршрут отправки выбирает вызывающая сторона.
 */
export function VoiceComposer({ onSend, onActiveChange, disabled }: Props) {
  const voice = useVoiceRecorder()
  const { state, reset } = voice
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const recording = state.phase === 'requesting' || state.phase === 'recording'
  const recorded = state.phase === 'recorded' ? state.voice : null
  const active = state.phase !== 'idle'
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  useEffect(() => {
    if (disabled && recording) reset()
  }, [disabled, recording, reset])

  useEffect(() => {
    if (!recorded) return
    const url = URL.createObjectURL(recorded.blob)
    setVoiceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [recorded])

  // Ошибку записи (нет доступа к микрофону и т.п.) показываем тостом — иначе клик
  // по кнопке выглядит «мёртвым».
  useEffect(() => {
    if (voice.error) toast(voice.error, 'error')
  }, [voice.error])

  function start() {
    if (!voice.supported) {
      toast(
        'Запись голоса недоступна: нужен HTTPS (или localhost) и доступ к микрофону',
        'error',
      )
      return
    }
    void voice.start()
  }

  function discard() {
    setVoiceUrl(null)
    reset()
  }

  async function submit() {
    if (!recorded || sending) return
    setSending(true)
    try {
      // Только локальная упаковка (без сети) — сама заливка идёт в родителе (outbox
      // для верхнего уровня). Так голосовое ставится в очередь и офлайн.
      const pending = await preparePendingVoice(recorded.blob, recorded.duration)
      onSend(pending)
      discard()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось отправить голосовое', 'error')
    } finally {
      setSending(false)
    }
  }

  if (recorded && voiceUrl) {
    return (
      <div className={styles.voiceBar}>
        <button
          className={styles.iconBtn}
          onClick={discard}
          disabled={sending}
          title="Удалить"
          aria-label="Удалить запись"
        >
          <IconClose size={18} />
        </button>
        <VoicePlayer
          src={voiceUrl}
          duration={recorded.duration}
          className={styles.voicePreview}
          waveform
        />
        <button
          className={styles.sendBtn}
          onClick={submit}
          disabled={sending || disabled}
          title="Отправить голосовое"
          aria-label="Отправить голосовое"
        >
          {sending ? <Spinner size={16} /> : <IconSend size={20} />}
        </button>
      </div>
    )
  }

  return (
    <VoicePill
      active={recording}
      startedAt={state.phase === 'recording' ? state.startedAt : null}
      disabled={disabled || (active && !recording)}
      readLevel={voice.readLevel}
      onStart={start}
      onStop={voice.stop}
      onCancel={reset}
      onRelease={voice.resumeMeter}
    />
  )
}
