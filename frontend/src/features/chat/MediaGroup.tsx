import { useState } from 'react'
import { Lightbox, type LightboxItem } from '../../components/Overlay'
import { Spinner } from '../../components/Spinner'
import type { AttachmentOut } from '../../lib/types'
import styles from './chat.module.css'

/**
 * Альбом: несколько фото/видео одного сообщения одной сеткой (как в мессенджерах),
 * а не колонкой отдельных боксов. Раскладка зависит от числа плиток (2..6 — ровно
 * столько, сколько принимает бэкенд, см. MAX_ATTACHMENTS); у старых сообщений
 * вложений может быть больше — тогда просто сетка 3 в ряд.
 *
 * Плитка = превью (thumb_url) в object-fit: cover, поэтому альбом всегда прямоугольный
 * и не «рвётся» на разных пропорциях. Оригинал/средний дериват открывается в лайтбоксе,
 * который листает всю группу — по клику по любой плитке.
 *
 * Одиночное вложение сюда НЕ попадает: оно рисуется как раньше (Attachment.tsx) — со
 * своими пропорциями, нативным видеоплеером и плеером голосового.
 */
export function MediaGroup({ items }: { items: AttachmentOut[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null)

  // Что открывать в просмотре: у картинки — средний дериват (оригинал в 11 МБ на
  // телефоне незачем), у видео — сам объект (транскод-вариант, если готов).
  const lightboxItems: LightboxItem[] = items.map((att) => ({
    url: att.kind === 'image' ? att.preview_url ?? att.url : att.url,
    kind: att.kind === 'video' ? 'video' : 'image',
  }))

  // Раскладка по числу плиток; всё, что выше потолка (легаси-сообщения), — общая сетка.
  const layout = styles[`album${items.length}`] ?? styles.albumMany

  return (
    <>
      <div className={`${styles.album} ${layout}`}>
        {items.map((att, i) => (
          <Tile key={att.asset_id} att={att} onOpen={() => setOpenAt(i)} />
        ))}
      </div>
      {openAt !== null && (
        <Lightbox
          items={lightboxItems}
          index={openAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  )
}

/** Плитка альбома: превью + бейдж видео. Видео в транскоде играть нельзя — не кликается. */
function Tile({ att, onOpen }: { att: AttachmentOut; onOpen: () => void }) {
  // Превью может не быть (легаси-запись / генерация не удалась) — тогда грузим сам
  // объект: для картинки это оригинал, для видео постера не будет вовсе.
  const src = att.thumb_url ?? (att.kind === 'image' ? att.url : null)
  const processing = att.kind === 'video' && att.transcode_status === 'processing'

  if (processing)
    return (
      <div className={styles.albumTile}>
        {src && <img className={styles.albumImg} src={src} alt="" />}
        <span className={styles.albumOverlay}>
          <Spinner size={18} />
        </span>
      </div>
    )

  return (
    <button className={styles.albumTile} type="button" onClick={onOpen}>
      {src ? (
        <img className={styles.albumImg} src={src} alt="" />
      ) : (
        <span className={styles.albumBlank} />
      )}
      {att.kind === 'video' && (
        <span className={styles.albumPlay} aria-hidden="true">
          <PlayGlyph />
        </span>
      )}
    </button>
  )
}

function PlayGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  )
}
