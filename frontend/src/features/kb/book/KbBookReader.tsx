import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useKbItem } from '../../../api/kb'
import { Spinner } from '../../../components/Spinner'
import { parseBook } from './parseBook'
import styles from './book.module.css'

// Full-screen reader for a KB "book" material (kb_items.kind = 'book'). Chapters
// are parsed from the item's markdown `body` on the `##` headings; a table of
// contents rail tracks the chapter in view via IntersectionObserver. Layout is
// adapted from the Manifesto reader (TOC + reading column), themed with our
// design tokens instead of inline colors.
export function KbBookReader() {
  const { itemId } = useParams<{ itemId: string }>()
  const id = Number(itemId ?? '0')
  const { data: item, isLoading } = useKbItem(id)
  const [searchParams] = useSearchParams()

  const book = useMemo(() => (item?.body ? parseBook(item.body) : null), [item?.body])

  const [active, setActive] = useState(0)
  const jumpedRef = useRef(false)
  const [tocOpen, setTocOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chapterRefs = useRef<(HTMLElement | null)[]>([])
  const scrollingRef = useRef(false)
  const scrollTimer = useRef<number | undefined>(undefined)

  // Highlight the chapter currently in view (unless we're mid programmatic jump).
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !book) return
    const observers = book.chapters.map((_, i) => {
      const el = chapterRefs.current[i]
      if (!el) return null
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !scrollingRef.current) setActive(i)
        },
        { root, threshold: 0, rootMargin: '0px 0px -70% 0px' },
      )
      obs.observe(el)
      return obs
    })
    return () => observers.forEach((o) => o?.disconnect())
  }, [book])

  // Deep-link: `?ch=N` (chapter number, e.g. from a Gene Key) or `#slug` jumps
  // to that chapter once, after the chapters have mounted.
  useEffect(() => {
    if (!book || jumpedRef.current) return
    const chParam = searchParams.get('ch')
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''))
    let target = -1
    if (chParam) target = book.chapters.findIndex((c) => c.num === chParam.trim())
    if (target < 0 && hash) target = book.chapters.findIndex((c) => c.slug === hash)
    if (target >= 0) {
      jumpedRef.current = true
      // Defer to next frame so refs are attached and layout is settled.
      requestAnimationFrame(() => goToChapter(target))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book])

  function goToChapter(i: number) {
    setActive(i)
    setTocOpen(false)
    scrollingRef.current = true
    window.clearTimeout(scrollTimer.current)
    const el = chapterRefs.current[i]
    const root = scrollRef.current
    if (el && root) {
      const top = root.scrollTop + (el.getBoundingClientRect().top - root.getBoundingClientRect().top) - 8
      root.scrollTo({ top, behavior: 'smooth' })
      scrollTimer.current = window.setTimeout(() => {
        scrollingRef.current = false
      }, 700)
    } else {
      scrollingRef.current = false
    }
  }

  if (isLoading) return <div className="center grow"><Spinner /></div>
  if (!item) return <div className="center grow muted">Материал не найден</div>
  if (!book || book.chapters.length === 0) {
    return <div className="center grow muted">В этой книге пока нет глав</div>
  }

  const activeChapter = book.chapters[active]

  return (
    <div className={styles.reader}>
      <div className={styles.topbar}>
        <Link to={`/kb`} className={styles.back}>← База знаний</Link>
        <span className={styles.bookName}>{book.title || item.title}</span>
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
                className={`${styles.tocItem} ${active === i ? styles.tocItemActive : ''}`}
                onClick={() => goToChapter(i)}
              >
                <span className={styles.tocNum}>{ch.num}</span>
                <span className={styles.tocTitle}>{ch.title}</span>
              </button>
            ))}
          </div>
        </nav>

        <div ref={scrollRef} className={styles.pane}>
          {book.chapters.map((ch, i) => (
            <article
              key={ch.slug}
              id={ch.slug}
              ref={(el) => { chapterRefs.current[i] = el }}
              className={styles.chapter}
            >
              <div className={styles.chapterKicker}>Глава {ch.num}</div>
              <h2 className={styles.chapterTitle}>{ch.title}</h2>
              <div className={styles.hairline} />
              <div
                className={styles.prose}
                // Sanitized in parseBook.
                dangerouslySetInnerHTML={{ __html: ch.html }}
              />
            </article>
          ))}
          <div className={styles.tail} />
        </div>
      </div>
    </div>
  )
}
