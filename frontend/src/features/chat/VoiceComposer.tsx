import { useEffect, useState } from 'react'
import { IconClose, IconMic, IconSend, IconTrash } from '../../components/icons'
import { VoicePlayer } from '../../components/VoicePlayer'
import { preparePendingVoice, type PendingUpload } from '../../lib/mediaUpload'
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder'
import { toast } from '../../stores/toast'
import styles from './chat.module.css'

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

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
 * Запись + предпрослушивание + отправка голосового. Общий для основного композера
 * и панели треда — оба вызывают `onSend(assetId)`, а как именно слать (top-level или
 * reply_to) решает вызывающая сторона.
 *
 * Состояния: idle → микрофон; recording → таймер + стоп/отмена; recorded → плеер +
 * отправить/удалить. Пока идёт запись/превью, вызывающий скрывает своё поле ввода.
 */
export function VoiceComposer({ onSend, onActiveChange, disabled }: Props) {
  const voice = useVoiceRecorder()
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const active = voice.state === 'recording' || voice.state === 'recorded'
  useEffect(() => {
    onActiveChange?.(active)
  }, [active, onActiveChange])

  useEffect(() => {
    if (!voice.recorded) return
    const url = URL.createObjectURL(voice.recorded.blob)
    setVoiceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [voice.recorded])

  // Ошибку записи (нет доступа к микрофону и т.п.) показываем тостом — иначе клик
  // по кнопке выглядит «мёртвым».
  useEffect(() => {
    if (voice.error) toast(voice.error, 'error')
  }, [voice.error])

  async function start() {
    if (!voice.supported) {
      toast(
        'Запись голоса недоступна: нужен HTTPS (или localhost) и доступ к микрофону',
        'error',
      )
      return
    }
    await voice.start()
  }

  function discard() {
    setVoiceUrl(null)
    voice.reset()
  }

  async function submit() {
    if (!voice.recorded || sending) return
    setSending(true)
    try {
      // Только локальная упаковка (без сети) — сама заливка идёт в родителе (outbox
      // для верхнего уровня). Так голосовое ставится в очередь и офлайн.
      const pending = await preparePendingVoice(voice.recorded.blob, voice.recorded.duration)
      onSend(pending)
      discard()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось отправить голосовое', 'error')
    } finally {
      setSending(false)
    }
  }

  if (voice.state === 'recording') {
    return (
      <div className={styles.voiceBar}>
        <span className={styles.recDot} aria-hidden />
        <span className={styles.recLabel}>Запись…</span>
        <span className={styles.recTime}>{fmtDur(voice.elapsed)}</span>
        <div className={styles.voiceBarSpacer} />
        <button
          className={styles.iconBtn}
          onClick={discard}
          title="Отменить"
          aria-label="Отменить запись"
        >
          <IconTrash size={18} />
        </button>
        <button
          className={styles.sendBtn}
          onClick={() => voice.stop()}
          title="Остановить"
          aria-label="Остановить запись"
        >
          <IconSend size={20} />
        </button>
      </div>
    )
  }

  if (voice.state === 'recorded' && voiceUrl) {
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
          duration={voice.recorded?.duration}
          className={styles.voicePreview}
        />
        <button
          className={styles.sendBtn}
          onClick={submit}
          disabled={sending || disabled}
          title="Отправить голосовое"
          aria-label="Отправить голосовое"
        >
          {sending ? <span className={styles.spin} /> : <IconSend size={20} />}
        </button>
      </div>
    )
  }

  // idle: одна кнопка-микрофон.
  return (
    <button
      className={styles.iconBtn}
      onClick={start}
      disabled={disabled}
      title="Записать голосовое"
      aria-label="Записать голосовое"
    >
      <IconMic size={18} />
    </button>
  )
}
