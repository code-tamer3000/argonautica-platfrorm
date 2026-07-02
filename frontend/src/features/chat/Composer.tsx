import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useSendMessage, type SendBody } from '../../api/messages'
import { IconAttach, IconSend, IconSticker } from '../../components/icons'
import { mediaUpload } from '../../lib/mediaUpload'
import type { MediaAssetOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { wsClient } from '../../lib/wsClient'
import { StickerPicker } from './StickerPicker'
import { VoiceComposer } from './VoiceComposer'
import styles from './chat.module.css'

interface Props {
  roomId: number
}

export function Composer({ roomId }: Props) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<MediaAssetOut[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Прогресс текущей загрузки в процентах (null — загрузки нет).
  const [progress, setProgress] = useState<number | null>(null)
  // Идёт запись/превью голосового → прячем текстовый ряд (VoiceComposer сам его рисует).
  const [voiceActive, setVoiceActive] = useState(false)
  const send = useSendMessage(roomId)
  const lastTyping = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    setProgress(0)
    try {
      const asset = await mediaUpload(file, (f) => setProgress(Math.round(f * 100)))
      setPendingFiles(prev => [...prev, asset])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
      setProgress(null)
    }
  }

  function handleSticker(stickerId: number) {
    setPickerOpen(false)
    send.mutate({ sticker_id: stickerId })
  }

  function submit() {
    const content = text.trim()
    const hasContent = content || pendingFiles.length > 0
    if (!hasContent || send.isPending) return
    const body: SendBody = {}
    if (content) body.content = content
    if (pendingFiles.length) body.attachment_ids = pendingFiles.map(a => a.id)
    setText('')
    setPendingFiles([])
    send.mutate(body)
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

  const canSend = !!text.trim() || pendingFiles.length > 0

  return (
    <div className={styles.composer}>
      {pendingFiles.length > 0 && (
        <div className={styles.pendingAtt}>
          {pendingFiles.map(a => (
            <span key={a.id} className={styles.pendingChip}>
              <IconAttach size={13} />
              <span className={styles.pendingChipLabel}>
                {a.kind === 'image' ? 'Изображение' : a.kind === 'video' ? 'Видео' : 'Файл'}
              </span>
              <button
                className={styles.pendingChipX}
                onClick={() => setPendingFiles(prev => prev.filter(f => f.id !== a.id))}
                aria-label="Убрать вложение"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {progress !== null && (
        <div className={styles.uploadProgress}>
          <div className={styles.uploadBar}>
            <div className={styles.uploadBarFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.uploadPct}>{progress}%</span>
        </div>
      )}

      {pickerOpen && <StickerPicker onPick={handleSticker} />}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={handleFileChange}
      />

      {/* Единый composerRow. VoiceComposer держим смонтированным ВСЕГДА (иначе при
          старте записи он бы пересоздался и потерял состояние). Пока идёт запись/
          превью (voiceActive) — прячем остальные контролы, VoiceComposer сам
          растягивается в панель. */}
      <div className={styles.composerRow}>
        {!voiceActive && (
          <>
            <button
              className={styles.iconBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Прикрепить файл"
              aria-label="Прикрепить файл"
            >
              {uploading ? <span className={styles.spin} /> : <IconAttach size={18} />}
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => setPickerOpen(v => !v)}
              title="Стикер"
              aria-label="Стикер"
            >
              <IconSticker size={18} />
            </button>
            <textarea
              className={styles.composerInput}
              rows={1}
              placeholder="Сообщение…"
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKey}
            />
          </>
        )}
        {/* Есть что отправить → круглая кнопка отправки; иначе — VoiceComposer
            (в idle = кнопка-микрофон, в записи/превью = полная панель). */}
        {canSend && !voiceActive ? (
          <button
            className={styles.sendBtn}
            onClick={submit}
            disabled={send.isPending}
            title="Отправить"
            aria-label="Отправить"
          >
            {send.isPending ? <span className={styles.spin} /> : <IconSend size={20} />}
          </button>
        ) : (
          <VoiceComposer
            onSend={(assetId) => send.mutate({ attachment_ids: [assetId] })}
            onActiveChange={setVoiceActive}
          />
        )}
      </div>
    </div>
  )
}
