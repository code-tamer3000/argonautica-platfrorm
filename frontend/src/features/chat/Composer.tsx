import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  buildJournalContent,
  repostMessage,
  useSendMessage,
  type SendBody,
} from '../../api/messages'
import { useJournalStructure } from '../../api/journal'
import { useUsersMap } from '../../api/users'
import { IconAttach, IconSend, IconSticker } from '../../components/icons'
import { useAutosize } from '../../hooks/useAutosize'
import { mediaUpload } from '../../lib/mediaUpload'
import type { MediaAssetOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { wsClient } from '../../lib/wsClient'
import { enqueue as outboxEnqueue } from '../../lib/outbox'
import { clearDraft, saveDraft, loadDraft } from '../../lib/drafts'
import { useAuth } from '../auth/AuthContext'
import { StickerPicker } from './StickerPicker'
import { VoiceComposer } from './VoiceComposer'
import styles from './chat.module.css'

interface Props {
  roomId: number
  // Новостной канал: здесь композер умеет «держать» репост (pendingRepost) и даёт
  // дописать к нему комментарий перед отправкой.
  isNews?: boolean
  // Личный дневник: композер появляется по выбору режима — проигрываем мягкое
  // выезжание при монтировании, чтобы он не «выпрыгивал».
  revealOnMount?: boolean
}

export function Composer({ roomId, isNews, revealOnMount }: Props) {
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
  const { user } = useAuth()
  const pendingRepost = useUiStore((s) => s.pendingRepost)
  const setPendingRepost = useUiStore((s) => s.setPendingRepost)
  const pendingJournal = useUiStore((s) => s.pendingJournal)
  const setPendingJournal = useUiStore((s) => s.setPendingJournal)
  const pendingDraft = useUiStore((s) => s.pendingDraft)
  const setPendingDraft = useUiStore((s) => s.setPendingDraft)
  // Репост показываем только в композере новостного канала.
  const repost = isNews ? pendingRepost : null
  // Раздел дневника, «заряженный» именно в эту комнату: следующая отправка
  // (текст/файл/голос/стикер) уходит как запись дневника этого раздела. Мета
  // раздела берётся из активного задания (см. api/journal.ts).
  const { data: structure } = useJournalStructure()
  const journalKey = pendingJournal?.roomId === roomId ? pendingJournal.category : null
  const journalMeta = journalKey
    ? structure?.sections.find((s) => s.key === journalKey) ?? null
    : null

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

  // Восстановление сохранённого черновика при открытии комнаты: если пользователь
  // печатал и ушёл (сменил вкладку/комнату, перезагрузил), текст возвращается.
  // Не перетираем «заряженный» извне pendingDraft (у него приоритет). Гонки нет:
  // roomId в замыкании фиксирован, ложим только если поле ещё пустое.
  useEffect(() => {
    if (pendingDraft?.roomId === roomId) return
    let cancelled = false
    void loadDraft(roomId).then((saved) => {
      if (!cancelled && saved) {
        setText((cur) => (cur ? cur : saved))
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // Черновик, «заряженный» извне (напр. шапка ответа админа на обращение из
  // техподдержки): один раз подставляем в текст этой комнаты, ставим фокус и
  // курсор в конец, затем сбрасываем — дальше админ дописывает сам.
  useEffect(() => {
    if (pendingDraft?.roomId !== roomId) return
    setText(pendingDraft.text)
    setPendingDraft(null)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    })
  }, [pendingDraft, roomId, setPendingDraft, inputRef])

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
    if (journalMeta) {
      // Стикер как «отписка» дня: несёт маркер+заголовок раздела в content, чтобы
      // сервер засчитал день, плюс сам стикер.
      send.mutate(
        { content: buildJournalContent(journalMeta, text.trim()), sticker_id: stickerId },
        { onSuccess: afterJournalSent },
      )
      setText('')
      return
    }
    enqueueSend({ sticker_id: stickerId })
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

  // Обычная отправка через outbox: сообщение сразу видно в ленте как «отправляется»
  // и переживает падение сети/перезагрузку (см. lib/outbox.ts). Черновик комнаты
  // очищаем — текст ушёл в очередь.
  function enqueueSend(body: SendBody) {
    if (user) outboxEnqueue(roomId, body, user.id)
    else send.mutate(body) // без пользователя (не должно случаться) — прямой путь
    void clearDraft(roomId)
  }

  async function submit() {
    if (send.isPending || reposting) return
    justSentRef.current = true
    setTimeout(() => { justSentRef.current = false }, 300)

    // Запись дневника: маркер+заголовок раздела в content (+ опциональные вложения).
    // Для раздела-«заголовка» (input_type='title') текст обязателен — он и есть заголовок.
    if (journalMeta) {
      const value = text.trim()
      if (journalMeta.input_type === 'title' && !value) {
        toast(`Введите: ${journalMeta.label}`, 'error')
        return
      }
      if (!value && pendingFiles.length === 0) return
      const body: SendBody = { content: buildJournalContent(journalMeta, value) }
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
      if (body.content || body.attachment_ids?.length) enqueueSend(body)
      toast('Отправлено в новости')
      return
    }

    const content = text.trim()
    if (!content && pendingFiles.length === 0) return
    enqueueSend(sendBody())
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
    // Черновик комнаты (дебаунс внутри). Записи дневника/репост не кэшируем как
    // черновик — у них свой «заряд» и очистка; сохраняем только обычный текст.
    if (!journalMeta && !repost) saveDraft(roomId, value)
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
    <div className={`${styles.composer} ${revealOnMount ? styles.composerReveal : ''}`}>
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
        <div className={`${styles.contextBar} ${styles.contextBarJournal}`}>
          <span className={styles.ctxLabel}>{journalMeta.emoji} {journalMeta.label}</span>
          <span className={styles.ctxDesc}>{journalMeta.placeholder}</span>
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
              journalMeta
                ? send.mutate(
                    { content: buildJournalContent(journalMeta, text.trim()), attachment_ids: [assetId] },
                    { onSuccess: afterJournalSent },
                  )
                : enqueueSend({ attachment_ids: [assetId] })
            }
            onActiveChange={setVoiceActive}
          />
        )}
      </div>
    </div>
  )
}
