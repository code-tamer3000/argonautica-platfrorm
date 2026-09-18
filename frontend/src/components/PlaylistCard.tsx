import { useEffect, useState } from 'react'
import { removePlaylistTrack, renamePlaylist } from '../api/media'
import { useAuth } from '../features/auth/AuthContext'
import type { PlaylistOut } from '../lib/types'
import { usePlayerStore } from '../stores/player'
import { toast } from '../stores/toast'
import { IconMusic, IconPause, IconPlay, IconTrash } from './icons'
import { KebabMenu } from './KebabMenu'
import styles from './playlistCard.module.css'

function fmt(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '–:–'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Карточка плейлиста-вложения (docs/FILES.md «Плейлист») — рендер вложения в
 * сообщении чата, задании и материале Базы знаний. Тап по треку запускает
 * ГЛОБАЛЬНЫЙ плеер (см. stores/player.ts) с этого трека; сама карточка
 * не проигрывает звук — это делает `<GlobalPlayer>`, смонтированный в layout'е.
 *
 * Автору доступна правка через «3 точки» (ARG-139, отзыв после ревью): переименовать
 * плейлист, убрать трек. Состояние держим локально (`local`) и синхронизируем с
 * проигрывающимся плейлистом в сторе — сам `playlist` в кэше сообщения/задачи/
 * материала не мутируем (пришёл бы актуальным на следующем перечитывании страницы).
 */
export function PlaylistCard({ playlist }: { playlist: PlaylistOut }) {
  const { user } = useAuth()
  const isOwner = user != null && user.id === playlist.created_by

  const [local, setLocal] = useState(playlist)
  useEffect(() => setLocal(playlist), [playlist])

  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(local.title)

  const activePlaylist = usePlayerStore((s) => s.playlist)
  const activeIndex = usePlayerStore((s) => s.trackIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isThisPlaylist = activePlaylist?.id === local.id

  function applyUpdate(updated: PlaylistOut) {
    setLocal(updated)
    // Тот же плейлист сейчас играет в глобальном плеере — обновить и там, иначе
    // мини-бар/развёрнутый вид продолжат показывать старое название/список.
    if (activePlaylist?.id === updated.id) {
      usePlayerStore.setState((s) => ({
        playlist: updated,
        trackIndex: Math.min(s.trackIndex, Math.max(updated.tracks.length - 1, 0)),
      }))
    }
  }

  async function saveTitle() {
    const title = titleDraft.trim()
    setRenaming(false)
    if (!title || title === local.title) return
    try {
      applyUpdate(await renamePlaylist(local.id, title))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось переименовать', 'error')
    }
  }

  async function removeTrack(trackId: number) {
    if (local.tracks.length <= 1) {
      toast('В плейлисте должен остаться хотя бы один трек', 'error')
      return
    }
    try {
      applyUpdate(await removePlaylistTrack(local.id, trackId))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось убрать трек', 'error')
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.cover}>
          {local.cover_url ? <img src={local.cover_url} alt="" /> : <IconMusic size={20} />}
        </div>
        <div className={styles.headerMeta}>
          {renaming ? (
            <input
              className={styles.titleEdit}
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setTitleDraft(local.title)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <span className={styles.title}>{local.title}</span>
          )}
          <span className={styles.count}>
            {local.tracks.length} {local.tracks.length === 1 ? 'трек' : 'треков'}
          </span>
        </div>
        {isOwner && !renaming && (
          <KebabMenu
            ariaLabel="Действия с плейлистом"
            items={[
              {
                key: 'rename',
                label: 'Переименовать',
                onClick: () => {
                  setTitleDraft(local.title)
                  setRenaming(true)
                },
              },
            ]}
          />
        )}
      </div>
      <ul className={styles.tracks}>
        {local.tracks.map((track, i) => {
          const active = isThisPlaylist && activeIndex === i
          return (
            <li key={track.id} className={styles.trackRow}>
              <button
                type="button"
                className={`${styles.track} ${active ? styles.trackActive : ''}`}
                onClick={() => {
                  if (active) usePlayerStore.getState().toggle()
                  else usePlayerStore.getState().playPlaylist(local, i)
                }}
              >
                <span className={styles.trackIcon}>
                  {active && isPlaying ? <IconPause size={14} /> : <IconPlay size={14} />}
                </span>
                <span className={styles.trackMeta}>
                  <span className={styles.trackTitle}>{track.title}</span>
                  {track.artist && <span className={styles.trackArtist}>{track.artist}</span>}
                </span>
                <span className={styles.trackDuration}>{fmt(track.duration)}</span>
              </button>
              {isOwner && (
                <button
                  type="button"
                  className={styles.trackRemove}
                  onClick={() => void removeTrack(track.id)}
                  aria-label="Убрать трек"
                >
                  <IconTrash size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
