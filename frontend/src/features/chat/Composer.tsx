import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useSendMessage, type SendBody } from '../../api/messages'
import { IconAttach, IconSend, IconSticker } from '../../components/icons'
import { mediaUpload } from '../../lib/mediaUpload'
import type { MediaAssetOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { wsClient } from '../../lib/wsClient'
import { StickerPicker } from './StickerPicker'
import styles from './chat.module.css'

interface Props {
  roomId: number
}

export function Composer({ roomId }: Props) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<MediaAssetOut[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const send = useSendMessage(roomId)
  const lastTyping = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const asset = await mediaUpload(file)
      setPendingFiles(prev => [...prev, asset])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
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

      {pickerOpen && <StickerPicker onPick={handleSticker} />}

      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={handleFileChange}
      />

      <div className={styles.composerRow}>
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
        {/* Круглая кнопка отправки появляется только когда есть что отправить —
            в пустом состоянии не занимает место и не «давит» интерфейс. */}
        {canSend && (
          <button
            className={styles.sendBtn}
            onClick={submit}
            disabled={send.isPending}
            title="Отправить"
            aria-label="Отправить"
          >
            {send.isPending ? <span className={styles.spin} /> : <IconSend size={20} />}
          </button>
        )}
      </div>
    </div>
  )
}
