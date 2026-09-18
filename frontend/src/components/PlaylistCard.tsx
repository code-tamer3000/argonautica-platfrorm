import { usePlayerStore } from '../stores/player'
import type { PlaylistOut } from '../lib/types'
import { IconMusic, IconPause, IconPlay } from './icons'
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
 */
export function PlaylistCard({ playlist }: { playlist: PlaylistOut }) {
  const activePlaylist = usePlayerStore((s) => s.playlist)
  const activeIndex = usePlayerStore((s) => s.trackIndex)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isThisPlaylist = activePlaylist?.id === playlist.id

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.cover}>
          {playlist.cover_url ? (
            <img src={playlist.cover_url} alt="" />
          ) : (
            <IconMusic size={20} />
          )}
        </div>
        <div className={styles.headerMeta}>
          <span className={styles.title}>{playlist.title}</span>
          <span className={styles.count}>
            {playlist.tracks.length} {playlist.tracks.length === 1 ? 'трек' : 'треков'}
          </span>
        </div>
      </div>
      <ul className={styles.tracks}>
        {playlist.tracks.map((track, i) => {
          const active = isThisPlaylist && activeIndex === i
          return (
            <li key={track.asset_id}>
              <button
                type="button"
                className={`${styles.track} ${active ? styles.trackActive : ''}`}
                onClick={() => {
                  if (active) usePlayerStore.getState().toggle()
                  else usePlayerStore.getState().playPlaylist(playlist, i)
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
            </li>
          )
        })}
      </ul>
    </div>
  )
}
