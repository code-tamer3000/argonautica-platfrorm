import { useEffect, useState } from 'react'
import { IconMusic, IconTrash } from '../../components/icons'
import { usePlayerStore } from '../../stores/player'
import { useOfflinePlaylists } from '../../stores/offlinePlaylists'
import styles from './profile.module.css'

/**
 * Обложка плейлиста из сохранённого при скачивании снимка — `cover_url` в нём
 * presigned MinIO-ссылка на момент скачивания. Она переживает сам факт
 * скачивания нормально, но на холодном старте PWA (сеть/токен ещё не готовы)
 * первый запрос может упасть — а `<img>` сам его не повторит, даже когда сеть
 * появится (браузеры не ретраят упавший src). Тот же приём и та же гонка, что
 * уже чинили в `Avatar.tsx` (ARG-152): сбрасываем `broken` по событию `online`,
 * иначе музыкальная иконка-плейсхолдер остаётся навсегда после одного неудачного
 * запроса при старте.
 */
function Cover({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  useEffect(() => {
    const onOnline = () => setBroken(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])
  if (!url || broken) return <IconMusic size={18} />
  return <img src={url} alt="" onError={() => setBroken(true)} />
}

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
              <Cover url={playlist.cover_url} />
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
