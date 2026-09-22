import { useState } from 'react'
import { usePlaylists } from '../api/media'
import type { PlaylistOut } from '../lib/types'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { IconMusic } from './icons'
import { Input } from './Input'
import { Modal } from './Overlay'
import { Spinner } from './Spinner'
import styles from './playlistPicker.module.css'

/**
 * Пикер «прикрепить уже существующий плейлист» (docs/FILES.md «Плейлист»).
 *
 * Показывает только те плейлисты, что смотрящий и так видит: свои + прикреплённые
 * к носителю, доступному ему (сообщение в его комнате, видимая задача,
 * опубликованный материал) — область считает сервер, `GET /api/media/playlists`.
 * Клиент НЕ фильтрует ничего сам: список, который отдал сервер, и есть разрешённый.
 *
 * Отсюда же заводится новый плейлист — кнопка «Загрузить новый» отдаёт управление
 * обычному сценарию сборки из файлов (PlaylistComposer), чтобы у автора была одна
 * точка входа, а не две разные кнопки в интерфейсе.
 */
export function PlaylistPicker({
  onPick,
  onCreateNew,
  onClose,
}: {
  onPick: (playlist: PlaylistOut) => void
  onCreateNew: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const { data, isLoading } = usePlaylists(query, true)
  const items = data?.items ?? []

  return (
    <Modal title="Прикрепить плейлист" onClose={onClose}>
      <div className={styles.wrap}>
        <Button type="button" onClick={onCreateNew}>
          + Загрузить новый
        </Button>

        <Input
          placeholder="Поиск по названию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {isLoading ? (
          <div className="center"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState>
            {query ? 'Ничего не найдено' : 'Доступных плейлистов пока нет'}
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            {items.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => onPick(playlist)}
                >
                  <span className={styles.cover}>
                    {playlist.cover_url ? (
                      <img src={playlist.cover_url} alt="" />
                    ) : (
                      <IconMusic size={18} />
                    )}
                  </span>
                  <span className={styles.meta}>
                    <span className={styles.title}>{playlist.title}</span>
                    <span className={styles.count}>
                      {playlist.tracks.length}{' '}
                      {playlist.tracks.length === 1 ? 'трек' : 'треков'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
