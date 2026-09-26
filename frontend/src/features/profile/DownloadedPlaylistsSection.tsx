import { useEffect } from 'react'
import { IconMusic, IconTrash } from '../../components/icons'
import { usePlayerStore } from '../../stores/player'
import { useOfflinePlaylists } from '../../stores/offlinePlaylists'
import styles from './profile.module.css'

/**
 * Список плейлистов, скачанных для офлайна (ARG-145), между «О себе» и
 * «Статистика по дневнику» (ARG-153) — единственное место, где видно ВСЁ, что
 * уже лежит на устройстве, а не только то, что встретилось на текущей
 * странице через `PlaylistCard`. Тап — сразу воспроизведение с первого трека
 * (по договорённости в задаче: без промежуточного экрана выбора трека).
 * Пусто — блок не рендерится вовсе, тем же паттерном, что `DynamicsSection`.
 */
export function DownloadedPlaylistsSection() {
  const downloaded = useOfflinePlaylists((s) => s.downloaded)

  useEffect(() => {
    void useOfflinePlaylists.getState().loadDownloaded()
  }, [])

  if (downloaded.length === 0) return null

  return (
    <div className={styles.playlistsCard}>
      <h2 className={styles.playlistsTitle}>Скачанные плейлисты</h2>
      {downloaded.map((playlist) => (
        <div key={playlist.id} className={styles.playlistRow}>
          <button
            type="button"
            className={styles.playlistPlayBtn}
            onClick={() => usePlayerStore.getState().playPlaylist(playlist, 0)}
          >
            <span className={styles.playlistCover}>
              {playlist.cover_url ? <img src={playlist.cover_url} alt="" /> : <IconMusic size={18} />}
            </span>
            <span className={styles.playlistMeta}>
              <span className={styles.playlistTitle}>{playlist.title}</span>
              <span className={styles.playlistCount}>
                {playlist.tracks.length} {playlist.tracks.length === 1 ? 'трек' : 'треков'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className={styles.playlistRemoveBtn}
            onClick={() => void useOfflinePlaylists.getState().remove(playlist.id)}
            aria-label="Удалить с устройства"
            title="Удалить с устройства"
          >
            <IconTrash size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
