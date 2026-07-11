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
import { IconAttach, IconChevronDown, IconSend, IconSticker } from '../../components/icons'
import { useAutosize } from '../../hooks/useAutosize'
import { plural } from '../../lib/format'
import { preparePendingUpload, runPendingUpload, type PendingUpload } from '../../lib/mediaUpload'
import type { MessageOut } from '../../lib/types'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import { wsClient } from '../../lib/wsClient'
import { enqueue as outboxEnqueue, enqueueMedia } from '../../lib/outbox'
import { clearDraft, saveDraft, loadDraft } from '../../lib/drafts'
import { useAuth } from '../auth/AuthContext'
import { StickerPicker } from './StickerPicker'
import { useMentionAutocomplete } from './useMentionAutocomplete'
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
  // Открыт инлайн-тред: этот же композер шлёт ответы В ТРЕД (reply_to_message_id =
  // threadRootId), над полем — контекст-бар «Ответ в тред». Отдельного тредового
  // композера больше нет — вложения/стикеры/голос работают и в треде. threadRoot —
  // само корневое сообщение для превью в контекст-баре (может быть null, если корень
  // уехал за пагинацию: режим треда всё равно активен по threadRootId).
  threadRootId?: number | null
  threadRoot?: MessageOut | null
  onExitThread?: () => void
  // Фокус на поле ввода (тап, чтобы писать) → пролистать ленту к низу, чтобы последнее
  // сообщение не пряталось за клавиатурой. В режиме треда не вызываем — тред скроллит
  // свой конец сам (InlineThread).
  onFocusInput?: () => void
}

export function Composer({ roomId, isNews, revealOnMount, threadRootId = null, threadRoot, onExitThread, onFocusInput }: Props) {
  // Режим треда активен по id (корень для превью может отсутствовать в ленте).
  const inThread = threadRootId != null
  const [text, setText] = useState('')
  // Прикреплённые, но ещё не отправленные вложения: сырые описатели (байты + мета),
  // ЕЩЁ НЕ залитые в MinIO. Обычная отправка/ответ в тред уводит их в outbox
  // (enqueueMedia) — заливка идёт в фоне из очереди, поэтому файл/голос переживают
  // офлайн так же, как текст. Дневник/репост требуют залитых ассетов → там заливаем
  // синхронно при отправке (см. submit).
  const [pendingFiles, setPendingFiles] = useState<PendingUpload[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
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
  const mentions = useMentionAutocomplete(inputRef, text, setText)

  // Смена контекста ответа (вошли/вышли из треда / другой корень) — начинаем с чистого
  // поля: текст верхнего уровня не должен утекать в тред и наоборот.
  const prevThreadRootId = useRef(threadRootId)
  useEffect(() => {
    if (prevThreadRootId.current !== threadRootId) {
      prevThreadRootId.current = threadRootId
      setText('')
      setPendingFiles([])
    }
  }, [threadRootId])

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
    try {
      // Только локальная подготовка (размеры/постер) — БЕЗ сети. Сама заливка уйдёт
      // в outbox при отправке, поэтому прикрепить файл можно и офлайн.
      const pending = await preparePendingUpload(file)
      setPendingFiles(prev => [...prev, pending])
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки файла', 'error')
    } finally {
      setUploading(false)
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
    // Стикер уходит отдельным сообщением (как раньше) — набранный текст не трогаем.
    enqueueTopLevel({ sticker_id: stickerId }, [])
  }

  // Отправка голосового. Верхний уровень — в outbox (enqueueMedia): переживает офлайн
  // так же, как файл. Дневник/ответ в тред — синхронная заливка (свои пути мимо outbox).
  async function handleVoice(pending: PendingUpload) {
    if (journalMeta) {
      try {
        const [assetId] = await uploadAll([pending])
        send.mutate(
          { content: buildJournalContent(journalMeta, text.trim()), attachment_ids: [assetId] },
          { onSuccess: afterJournalSent },
        )
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось отправить голосовое', 'error')
      }
      return
    }
    if (inThread && threadRootId != null) {
      try {
        const [assetId] = await uploadAll([pending])
        send.mutate({ reply_to_message_id: threadRootId, attachment_ids: [assetId] })
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось отправить голосовое', 'error')
      }
      return
    }
    enqueueTopLevel({}, [pending])
  }

  // Синхронно залить прикреплённые описатели и вернуть их asset_id. Используется на
  // путях, которые НЕ идут через outbox (дневник/репост/ответ в тред): им нужны
  // готовые ассеты, поэтому там заливка требует сети (бросит при офлайне).
  async function uploadAll(uploads: PendingUpload[]): Promise<number[]> {
    const ids: number[] = []
    for (const pu of uploads) {
      const asset = await runPendingUpload(pu)
      ids.push(asset.id)
    }
    return ids
  }

  // Верхнеуровневая отправка (обычное сообщение/голос): текст+стикер сразу, а сырые
  // вложения — в outbox через enqueueMedia (заливка в фоне из очереди, переживает
  // офлайн/перезагрузку). Без вложений — обычный enqueue. Черновик комнаты очищаем.
  function enqueueTopLevel(body: SendBody, uploads: PendingUpload[]) {
    if (!user) {
      send.mutate(body) // без пользователя (не должно случаться) — прямой путь
      return
    }
    if (uploads.length) enqueueMedia(roomId, body, user.id, uploads)
    else outboxEnqueue(roomId, body, user.id)
    void clearDraft(roomId)
  }

  async function submit() {
    if (send.isPending || reposting || uploading) return
    justSentRef.current = true
    setTimeout(() => { justSentRef.current = false }, 300)

    const content = text.trim()

    // Ответ в тред: прямой mutate (тред-реплики не живут в оптимистичной ленте
    // комнаты). Вложения тут заливаем синхронно — офлайн-outbox сюда не заведён.
    if (inThread && threadRootId != null) {
      if (!content && pendingFiles.length === 0) return
      const uploads = pendingFiles
      setText('')
      setPendingFiles([])
      const body: SendBody = { reply_to_message_id: threadRootId }
      if (content) body.content = content
      try {
        if (uploads.length) body.attachment_ids = await uploadAll(uploads)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось загрузить вложение', 'error')
        return
      }
      send.mutate(body)
      return
    }

    // Запись дневника: маркер+заголовок раздела в content (+ опциональные вложения).
    // Для раздела-«заголовка» (input_type='title') текст обязателен — он и есть заголовок.
    if (journalMeta) {
      if (journalMeta.input_type === 'title' && !content) {
        toast(`Введите: ${journalMeta.label}`, 'error')
        return
      }
      if (!content && pendingFiles.length === 0) return
      const uploads = pendingFiles
      setText('')
      setPendingFiles([])
      const body: SendBody = { content: buildJournalContent(journalMeta, content) }
      try {
        if (uploads.length) body.attachment_ids = await uploadAll(uploads)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось загрузить вложение', 'error')
        return
      }
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
      const uploads = pendingFiles
      setText('')
      setPendingFiles([])
      const body: SendBody = {}
      if (content) body.content = content
      try {
        if (uploads.length) body.attachment_ids = await uploadAll(uploads)
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось загрузить вложение', 'error')
        return
      }
      if (body.content || body.attachment_ids?.length) enqueueTopLevel(body, [])
      toast('Отправлено в новости')
      return
    }

    if (!content && pendingFiles.length === 0) return
    const uploads = pendingFiles
    setText('')
    setPendingFiles([])
    const body: SendBody = {}
    if (content) body.content = content
    enqueueTopLevel(body, uploads)
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // @-автодополнение перехватывает стрелки/Enter/Tab/Esc, пока открыт попап.
    if (mentions.onKeyDown(e)) return
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
    mentions.onValueChange()
    // Черновик комнаты (дебаунс внутри). Записи дневника/репост/тред не кэшируем как
    // черновик — у них свой контекст; сохраняем только обычный текст верхнего уровня.
    if (!journalMeta && !repost && !inThread) saveDraft(roomId, value)
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

  const threadSnippet = threadRoot
    ? threadRoot.content?.replace(/<!--journal:\w+-->/, '').trim() ||
      (threadRoot.sticker_id != null ? '[стикер]' : '[вложение]')
    : ''

  return (
    <div className={`${styles.composer} ${revealOnMount ? styles.composerReveal : ''}`}>
      {inThread && (
        <div className={`${styles.contextBar} ${styles.contextBarThread}`}>
          {/* «Свернуть тред» живёт здесь, над композером — всегда на виду, не нужно
              долистывать ленту вверх. Клик сворачивает инлайн-ветку и выходит из
              режима ответа (одно и то же состояние threadRootId). */}
          <button
            className={styles.threadCollapseBtn}
            onClick={() => onExitThread?.()}
            aria-label="Свернуть тред"
          >
            <IconChevronDown size={16} className={styles.threadCollapseChevron} />
            Свернуть тред
            {threadRoot != null && threadRoot.reply_count > 0 && (
              <span className={styles.ctxThreadCount}>
                · {threadRoot.reply_count} {plural(threadRoot.reply_count, ['ответ', 'ответа', 'ответов'])}
              </span>
            )}
          </button>
          <span className={styles.ctxSnippet}>{threadSnippet || '…'}</span>
        </div>
      )}
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
          {pendingFiles.map((pu, i) => (
            <span key={i} className={styles.pendingChip}>
              <IconAttach size={13} />
              <span className={styles.pendingChipLabel}>
                {pu.kind === 'image' ? 'Изображение' : pu.kind === 'video' ? 'Видео' : 'Файл'}
              </span>
              <button
                className={styles.pendingChipX}
                onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                aria-label="Убрать вложение"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {pickerOpen && <StickerPicker onPick={handleSticker} />}
      {mentions.popup}

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
                inThread
                  ? 'Ответить в тред…'
                  : repost
                    ? 'Добавить сообщение к репосту…'
                    : 'Сообщение…'
              }
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKey}
              onFocus={() => { if (!inThread) onFocusInput?.() }}
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
            onSend={handleVoice}
            onActiveChange={setVoiceActive}
          />
        )}
      </div>
    </div>
  )
}
