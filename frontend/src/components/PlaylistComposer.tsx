import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createPlaylist } from '../api/media'
import { readId3Tags, titleFromFileName } from '../lib/id3'
import { mediaUpload } from '../lib/mediaUpload'
import type { PlaylistOut } from '../lib/types'
import { toast } from '../stores/toast'
import { Button } from './Button'
import { IconMusic, IconTrash } from './icons'
import { PlaylistCard } from './PlaylistCard'
import { PlaylistPicker } from './PlaylistPicker'
import styles from './playlistComposer.module.css'

const MAX_PLAYLIST_TRACKS = 30

interface Draft {
  file: File
  mediaAssetId: number | null
  title: string
  artist: string
  duration: number | null
  cover: Blob | null
}

interface Props {
  /** Уже созданный плейлист (готовый прикрепить) — null, пока автор не собрал его. */
  value: PlaylistOut | null
  onChange: (playlist: PlaylistOut | null) => void
  disabled?: boolean
  /** Открыть панель выбора файлов сразу (без клика по кнопке «Плейлист») — когда
   * родитель уже показал её сам через свой пункт меню (см. chat/Composer.tsx). */
  autoOpen?: boolean
  /** Вызывается по «Отмена» — родитель может скрыть панель (autoOpen → false). */
  onClose?: () => void
  /** Панель сборки нового плейлиста появилась/исчезла. Нужен чату: он рисует
   * композер во всплывающей карточке со своим хромом (.playlistPop), и пока
   * открыт только пикер (он — модалка поверх экрана), карточка была бы пустой. */
  onBuildingChange?: (building: boolean) => void
  /** Уже прикреплённый плейлист показать полной карточкой (с правкой названия,
   * обложки и удалением отдельных треков), а не компактным чипом. Включаем в
   * формах задания и материала КБ — там правка вложения и есть смысл экрана;
   * в композере чата остаётся чип, чтобы не выдавливать поле ввода. */
  editable?: boolean
}

/**
 * Композер плейлиста-вложения (docs/FILES.md «Плейлист»): выбор нескольких
 * аудиофайлов разом → распознавание названия/исполнителя/обложки из ID3-тегов
 * (клиентский разбор, `lib/id3.ts`) → правка вручную → «Прикрепить» создаёт
 * плейлист на сервере (POST /api/media/playlists) и отдаёт готовый объект
 * родителю (composer сообщения / формы задания / формы материала КБ), который
 * пришлёт его `id` как `playlist_id` в следующем запросе.
 *
 * Состав плейлиста = ровно эти файлы, порядок = порядок выбора (без drag&drop —
 * см. Границы ARG-139). Плейлист неизменяем после отправки: если уже создан
 * (value != null), тут только просмотр + «Убрать».
 */
export function PlaylistComposer({
  value,
  onChange,
  disabled = false,
  autoOpen = false,
  onClose,
  editable = false,
  onBuildingChange,
}: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // Пикер «выбрать существующий» — первый экран при прикреплении: чаще всего
  // нужный плейлист уже есть на платформе, а заливка новых файлов — отдельная
  // ветка внутри него («+ Загрузить новый»).
  const [pickerOpen, setPickerOpen] = useState(false)
  // Автор выбрал в пикере «загрузить новый» — показываем панель сборки, даже пока
  // файлы ещё не выбраны (иначе после закрытия пикера не осталось бы ничего).
  const [creatingNew, setCreatingNew] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const autoOpenedRef = useRef(false)

  // autoOpen: родитель уже показал намерение (свой пункт меню) — сразу открыть
  // системный файловый диалог, не заставляя кликать по внутренней кнопке ещё раз.
  useEffect(() => {
    if (autoOpen && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      // Пикер, а не файловый диалог: выбрать уже существующий — частый случай,
      // а «загрузить новый» доступно первой же кнопкой внутри пикера.
      setPickerOpen(true)
    }
    if (!autoOpen) autoOpenedRef.current = false
  }, [autoOpen])

  // Панель сборки видна только в ветке «новый плейлист»: при autoOpen (чат) сперва
  // открывается пикер, и пока автор из него не вышел в загрузку, строить нечего.
  const open = drafts.length > 0 || creatingNew

  useEffect(() => {
    onBuildingChange?.(open)
  }, [open, onBuildingChange])

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    if (drafts.length + files.length > MAX_PLAYLIST_TRACKS) {
      toast(`В плейлисте не может быть больше ${MAX_PLAYLIST_TRACKS} треков`, 'error')
      return
    }
    const added: Draft[] = []
    for (const file of files) {
      const tags = await readId3Tags(file)
      added.push({
        file,
        mediaAssetId: null,
        title: tags.title || titleFromFileName(file.name),
        artist: tags.artist ?? '',
        duration: null,
        cover: tags.picture,
      })
    }
    setDrafts((prev) => {
      const next = [...prev, ...added]
      if (!title.trim()) setTitle(added[0]?.title ?? 'Плейлист')
      return next
    })
  }

  function removeDraft(idx: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateDraft(idx: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)))
  }

  async function attach() {
    if (!drafts.length) return
    setBusy(true)
    setUploadProgress({ done: 0, total: drafts.length })
    try {
      const tracks: { media_asset_id: number; title: string; artist: string | null; duration: number | null }[] = []
      let coverMediaId: number | null = null
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i]
        const { asset } = await mediaUpload(d.file)
        tracks.push({
          media_asset_id: asset.id,
          title: d.title.trim() || titleFromFileName(d.file.name),
          artist: d.artist.trim() || null,
          duration: d.duration ?? asset.duration ?? null,
        })
        if (coverMediaId === null && d.cover) {
          const coverFile = new File([d.cover], 'cover', { type: d.cover.type })
          const { asset: coverAsset } = await mediaUpload(coverFile)
          coverMediaId = coverAsset.id
        }
        setUploadProgress({ done: i + 1, total: drafts.length })
      }
      const playlist = await createPlaylist({
        title: title.trim() || 'Плейлист',
        cover_media_id: coverMediaId,
        tracks,
      })
      onChange(playlist)
      setDrafts([])
      setTitle('')
      setCreatingNew(false)
      onClose?.()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось создать плейлист', 'error')
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  if (value && editable) {
    // Правка плейлиста «на месте»: та же карточка, что видит получатель, с теми
    // же действиями автора/админа (переименовать, сменить обложку, убрать трек —
    // PATCH/DELETE /api/media/playlists/*). onChange держит state формы свежим.
    return (
      <div className={styles.attachedCard}>
        <PlaylistCard playlist={value} onChange={onChange} />
        <button
          type="button"
          className={styles.detach}
          onClick={() => onChange(null)}
          disabled={disabled}
        >
          <IconTrash size={14} /> Убрать плейлист целиком
        </button>
      </div>
    )
  }

  if (value) {
    return (
      <div className={styles.attached}>
        <span className={styles.attachedIcon}>
          {value.cover_url ? <img src={value.cover_url} alt="" /> : <IconMusic size={16} />}
        </span>
        <span className={styles.attachedMeta}>
          <span className={styles.attachedTitle}>{value.title}</span>
          <span className={styles.attachedCount}>{value.tracks.length} треков</span>
        </span>
        <button
          type="button"
          className={styles.attachedRemove}
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Убрать плейлист"
        >
          <IconTrash size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        multiple
        hidden
        tabIndex={-1}
        onChange={handleFileChange}
      />
      {!open && (
        <Button
          variant="outline"
          type="button"
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
        >
          <IconMusic size={16} /> Плейлист
        </Button>
      )}

      {pickerOpen && (
        <PlaylistPicker
          onPick={(picked) => {
            setPickerOpen(false)
            onChange(picked)
            onClose?.()
          }}
          onCreateNew={() => {
            setPickerOpen(false)
            setCreatingNew(true)
            fileRef.current?.click()
          }}
          onClose={() => {
            setPickerOpen(false)
            onClose?.()
          }}
        />
      )}

      {open && (
        <div className={styles.panel}>
          <input
            className={styles.titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название плейлиста"
            disabled={busy}
          />
          <ul className={styles.list}>
            {drafts.map((d, i) => (
              <li key={i} className={styles.item}>
                <span className={styles.itemPos}>{i + 1}</span>
                <div className={styles.itemFields}>
                  <input
                    className={styles.itemInput}
                    value={d.title}
                    onChange={(e) => updateDraft(i, { title: e.target.value })}
                    placeholder="Название трека"
                    disabled={busy}
                  />
                  <input
                    className={styles.itemInput}
                    value={d.artist}
                    onChange={(e) => updateDraft(i, { artist: e.target.value })}
                    placeholder="Исполнитель (необязательно)"
                    disabled={busy}
                  />
                </div>
                <button
                  type="button"
                  className={styles.itemRemove}
                  onClick={() => removeDraft(i)}
                  disabled={busy}
                  aria-label="Убрать трек"
                >
                  <IconTrash size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.panelActions}>
            <Button
              variant="outline"
              type="button"
              disabled={busy || drafts.length >= MAX_PLAYLIST_TRACKS}
              onClick={() => fileRef.current?.click()}
            >
              Добавить ещё
            </Button>
            <Button type="button" disabled={busy} onClick={() => void attach()}>
              {busy
                ? uploadProgress
                  ? `Загрузка ${uploadProgress.done} из ${uploadProgress.total}…`
                  : 'Загрузка…'
                : 'Прикрепить плейлист'}
            </Button>
            <button
              type="button"
              className={styles.cancel}
              disabled={busy}
              onClick={() => {
                setDrafts([])
                setTitle('')
                setCreatingNew(false)
                onClose?.()
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
