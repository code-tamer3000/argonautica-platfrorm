import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useKbItem } from '../../../api/kb'
import { useMediaUrl } from '../../../api/media'
import { Spinner } from '../../../components/Spinner'
import { parseBook } from './parseBook'
import styles from './book.module.css'

/**
 * Full-screen markdown reader for a `.md` file attached to a KB article. Given
 * the article id and the attachment id, it fetches the markdown from the file's
 * presigned URL and splits it into chapters on the `##` headings.
 *
 * We show **one chapter at a time** (selected from the TOC), not one long scroll:
 * switching is instant with no scroll animation, so a deep-link (`?ch=N` from a
 * Gene Key) opens straight on the right chapter without the page visibly racing
 * past the others. Layout adapted from the Manifesto reader, themed with our
 * design tokens.
 */
export function KbBookReader() {
  const { itemId, assetId } = useParams<{ itemId: string; assetId: string }>()
  const id = Number(itemId ?? '0')
  const asset = Number(assetId ?? '0')
  const [searchParams] = useSearchParams()

  const { data: item } = useKbItem(id)
  const { data: media, isLoading: mediaLoading } = useMediaUrl(asset || null)

  const [md, setMd] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  // Fetch the markdown bytes from the presigned URL once we have it.
  useEffect(() => {
    if (!media?.url) return
    let cancelled = false
    setMd(null)
    setLoadError(false)
    fetch(media.url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => { if (!cancelled) setMd(text) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [media?.url])

  const book = useMemo(() => (md ? parseBook(md) : null), [md])

  const [active, setActive] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)
  const jumpedRef = useRef(false)
  const paneRef = useRef<HTMLDivElement>(null)

  // Deep-link: `?ch=N` (chapter number, e.g. from a Gene Key) or `#slug` selects
  // that chapter once the book is parsed — no scrolling, just show it.
  useEffect(() => {
    if (!book || jumpedRef.current) return
    jumpedRef.current = true
    const chParam = searchParams.get('ch')
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    let target = -1
    if (chParam) target = book.chapters.findIndex((c) => c.num === chParam.trim())
    if (target < 0 && hash) target = book.chapters.findIndex((c) => c.slug === hash)
    if (target >= 0) setActive(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book])

  function selectChapter(i: number) {
    setActive(i)
    setTocOpen(false)
    // Start the new chapter from the top (it replaces the previous one in place).
    paneRef.current?.scrollTo({ top: 0 })
  }

  if (mediaLoading || (media && !md && !loadError)) {
    return <div className="center grow"><Spinner /></div>
  }
  if (loadError) return <div className="center grow muted">Не удалось загрузить файл</div>
  if (!book || book.chapters.length === 0) {
    return <div className="center grow muted">В этом документе пока нет глав</div>
  }

  const backTo = id > 0 ? `/kb/${id}` : '/kb'
  const safeActive = Math.min(active, book.chapters.length - 1)
  const activeChapter = book.chapters[safeActive]
  const heading = book.title || item?.title || 'Чтение'
  const prev = safeActive > 0 ? safeActive - 1 : null
  const next = safeActive < book.chapters.length - 1 ? safeActive + 1 : null

  return (
    <div className={styles.reader}>
      <div className={styles.topbar}>
        <Link to={backTo} className={styles.back}>← Назад</Link>
        <span className={styles.bookName}>{heading}</span>
        <button
          className={styles.tocToggle}
          onClick={() => setTocOpen((o) => !o)}
          aria-expanded={tocOpen}
        >
          {tocOpen ? '✕' : 'Главы'}
        </button>
      </div>

      {/* Mobile: current chapter strip */}
      <div className={styles.nowReading}>
        <span className={styles.nowNum}>{activeChapter.num}</span>
        <span className={styles.nowTitle}>{activeChapter.title}</span>
      </div>

      <div className={styles.body}>
        <nav className={`${styles.toc} ${tocOpen ? styles.tocOpen : ''}`} aria-label="Оглавление">
          <div className={styles.tocHead}>Главы</div>
          <div className={styles.tocScroll}>
            {book.chapters.map((ch, i) => (
              <button
                key={ch.slug}
                className={`${styles.tocItem} ${safeActive === i ? styles.tocItemActive : ''}`}
                onClick={() => selectChapter(i)}
              >
                <span className={styles.tocNum}>{ch.num}</span>
                <span className={styles.tocTitle}>{ch.title}</span>
              </button>
            ))}
          </div>
        </nav>

        <div ref={paneRef} className={styles.pane}>
          <article key={activeChapter.slug} className={styles.chapter}>
            <div className={styles.chapterKicker}>Глава {activeChapter.num}</div>
            <h2 className={styles.chapterTitle}>{activeChapter.title}</h2>
            <div className={styles.hairline} />
            <div
              className={styles.prose}
              // Sanitized in parseBook.
              dangerouslySetInnerHTML={{ __html: activeChapter.html }}
            />

            <nav className={styles.chapterNav}>
              {prev !== null ? (
                <button className={styles.navBtn} onClick={() => selectChapter(prev)}>
                  ← {book.chapters[prev].title}
                </button>
              ) : <span />}
              {next !== null ? (
                <button className={styles.navBtn} onClick={() => selectChapter(next)}>
                  {book.chapters[next].title} →
                </button>
              ) : <span />}
            </nav>
          </article>
          <div className={styles.tail} />
        </div>
      </div>
    </div>
  )
}
