import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  buildJournalContent,
  JOURNAL_CATEGORY_META,
  repostMessage,
  useSendMessage,
  type SendBody,
} from '../../api/messages'
import { useUsersMap } from '../../api/users'
import { IconAttach, IconSend, IconSticker } from '../../components/icons'
import { useAutosize } from '../../hooks/useAutosize'
import { mediaUpload } from '../../lib/mediaUpload'
import type { MediaAssetOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { wsClient } from '../../lib/wsClient'
import { StickerPicker } from './StickerPicker'
import { VoiceComposer } from './VoiceComposer'
import styles from './chat.module.css'

interface Props {
  roomId: number
  // Новостной канал: здесь композер умеет «держать» репост (pendingRepost) и даёт
  // дописать к нему комментарий перед отправкой.
  isNews?: boolean
}

export function Composer({ roomId, isNews }: Props) {
  const [text, setText] = useState('')
  const [pendingFiles, setPendingFiles] = useState<MediaAssetOut[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Прогресс текущей загрузки в процентах (null — загрузки нет).
  const [progress, setProgress] = useState<number | null>(null)
  // Идёт запись/превью голосового → прячем текстовый ряд (VoiceComposer сам его рисует).
  const [voiceActive, setVoiceActive] = useState(false)
  // Идёт отправка репоста (форвард создаётся до комментария).
  const [reposting, setReposting] = useState(false)
  const send = useSendMessage(roomId)
  const qc = useQueryClient()
  const users = useUsersMap()
  const pendingRepost = useUiStore((s) => s.pendingRepost)
  const setPendingRepost = useUiStore((s) => s.setPendingRepost)
  const pendingJournal = useUiStore((s) => s.pendingJournal)
  const setPendingJournal = useUiStore((s) => s.setPendingJournal)
  // Репост показываем только в композере новостного канала.
  const repost = isNews ? pendingRepost : null
  // Категория дневника, «заряженная» именно в эту комнату: следующая отправка
  // (текст/файл/голос/стикер) уходит как запись дневника этой категории.
  const journal = pendingJournal?.roomId === roomId ? pendingJournal.category : null
  const journalMeta = journal ? JOURNAL_CATEGORY_META[journal] : null

  // Успешно опубликовали запись дневника → снимаем «заряд» и обновляем прогресс дня
  // (бар над композером перечитает journal-days и проставит ✓).
  function afterJournalSent() {
    setPendingJournal(null)
    void qc.invalidateQueries({ queryKey: ['journal-days', roomId] })
  }
  const lastTyping = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const justSentRef = useRef(false)
  const inputRef = useAutosize(text)

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
    if (journal) {
      // Стикер как «отписка» дня: несёт маркер+заголовок категории в content, чтобы
      // сервер засчитал день, плюс сам стикер.
      send.mutate(
        { content: buildJournalContent(journal, text.trim()), sticker_id: stickerId },
        { onSuccess: afterJournalSent },
      )
      setText('')
      return
    }
    send.mutate({ sticker_id: stickerId })
  }

  function sendBody() {
    const content = text.trim()
    const body: SendBody = {}
    if (content) body.content = content
    if (pendingFiles.length) body.attachment_ids = pendingFiles.map(a => a.id)
    setText('')
    setPendingFiles([])
    return body
  }

  async function submit() {
    if (send.isPending || reposting) return
    justSentRef.current = true
    setTimeout(() => { justSentRef.current = false }, 300)

    // Запись дневника: маркер+заголовок категории в content (+ опциональные вложения).
    // Для «фильма дня» текст обязателен — он и есть название (заголовок записи).
    if (journal) {
      const value = text.trim()
      if (journal === 'film' && !value) {
        toast('Введите название фильма дня', 'error')
        return
      }
      if (!value && pendingFiles.length === 0) return
      const body: SendBody = { content: buildJournalContent(journal, value) }
      if (pendingFiles.length) body.attachment_ids = pendingFiles.map(a => a.id)
      setText('')
      setPendingFiles([])
      send.mutate(body, { onSuccess: afterJournalSent })
      return
    }

    // Репост в новости: сначала создаём форвард, затем — если что-то введено —
    // отдельным сообщением-комментарием (Telegram-стиль: переслано + подпись ниже).
    if (repost) {
      setReposting(true)
      try {
        await repostMessage(repost.roomId, repost.message.id)
      } catch {
        toast('Не удалось отправить репост', 'error')
        setReposting(false)
        return
      }
      setPendingRepost(null)
      setReposting(false)
      const body = sendBody()
      if (body.content || body.attachment_ids?.length) send.mutate(body)
      toast('Отправлено в новости')
      return
    }

    const content = text.trim()
    if (!content && pendingFiles.length === 0) return
    send.mutate(sendBody())
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey) return
    // Spurious Enter after button tap on mobile — just swallow it
    if (justSentRef.current) {
      e.preventDefault()
      return
    }
    // On touch devices Enter inserts a newline; send button is the only trigger
    const isTouch = window.matchMedia('(pointer: coarse)').matches
    if (!isTouch) {
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

  const canSend = !!text.trim() || pendingFiles.length > 0 || !!repost

  const repostAuthorId = repost
    ? repost.message.forwarded_from_sender_id ?? repost.message.sender_id
    : null
  const repostAuthor =
    repostAuthorId != null ? users.get(repostAuthorId)?.display_name ?? `Участник #${repostAuthorId}` : ''
  const repostSnippet = repost
    ? repost.message.content?.replace(/<!--journal:\w+-->/, '').trim() ||
      (repost.message.sticker_id != null ? '[стикер]' : '[вложение]')
    : ''

  return (
    <div className={styles.composer}>
      {repost && (
        <div className={styles.contextBar}>
          <span className={styles.ctxLabel}>Репост от {repostAuthor}:</span>
          <span>{repostSnippet}</span>
          <button
            className={styles.pendingChipX}
            onClick={() => setPendingRepost(null)}
            aria-label="Отменить репост"
          >
            ✕
          </button>
        </div>
      )}
      {journalMeta && (
        <div className={styles.contextBar}>
          <span className={styles.ctxLabel}>{journalMeta.emoji} {journalMeta.label}</span>
          <span>отписка дня — можно приложить файл, голос или стикер</span>
          <button
            className={styles.pendingChipX}
            onClick={() => setPendingJournal(null)}
            aria-label="Отменить запись дневника"
          >
            ✕
          </button>
        </div>
      )}
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
              ref={inputRef}
              className={styles.composerInput}
              rows={1}
              placeholder={
                journalMeta ? journalMeta.placeholder :
                repost ? 'Добавить сообщение к репосту…' : 'Сообщение…'
              }
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKey}
              enterKeyHint="enter"
            />
          </>
        )}
        {/* Есть что отправить → круглая кнопка отправки; иначе — VoiceComposer
            (в idle = кнопка-микрофон, в записи/превью = полная панель). */}
        {canSend && !voiceActive ? (
          <button
            className={styles.sendBtn}
            onClick={submit}
            disabled={send.isPending || reposting}
            title="Отправить"
            aria-label="Отправить"
          >
            {send.isPending || reposting ? <span className={styles.spin} /> : <IconSend size={20} />}
          </button>
        ) : (
          <VoiceComposer
            onSend={(assetId) =>
              journal
                ? send.mutate(
                    { content: buildJournalContent(journal, text.trim()), attachment_ids: [assetId] },
                    { onSuccess: afterJournalSent },
                  )
                : send.mutate({ attachment_ids: [assetId] })
            }
            onActiveChange={setVoiceActive}
          />
        )}
      </div>
    </div>
  )
}
