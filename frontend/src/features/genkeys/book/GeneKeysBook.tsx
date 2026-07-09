import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Hexagram } from '../Hexagram'
import { getKey } from '../wheel'
import { Spinner } from '../../../components/Spinner'
import { CHAPTER_COUNT, chapterTitle, useBookChapter } from './useBookChapter'
import styles from '../genkeys.module.css'

// Reader for the bundled book "Ричард Радд — 64 пути". One route per chapter
// (`/genkeys/book/:chapter`); chapter N is the contemplation of gene key N, so a
// key's reading can deep-link straight here. The per-key hexagram sigil from the
// source is dropped at build time and redrawn with our golden <Hexagram>.
export function GeneKeysBook() {
  const { chapter } = useParams<{ chapter: string }>()
  const navigate = useNavigate()
  const n = Number(chapter ?? '0')
  const valid = Number.isInteger(n) && n >= 1 && n <= CHAPTER_COUNT

  const { html, loading, error } = useBookChapter(valid ? n : null)

  // A new chapter starts at the top, not wherever the previous one was scrolled.
  useEffect(() => {
    document.getElementById('gkBookScroll')?.scrollTo({ top: 0 })
  }, [n])

  if (!valid) {
    return (
      <div className="center grow muted">
        Глава не найдена. <Link to="/genkeys/book/1">К началу книги →</Link>
      </div>
    )
  }

  const key = getKey(n)
  const title = chapterTitle(n)
  const prev = n > 1 ? n - 1 : null
  const next = n < CHAPTER_COUNT ? n + 1 : null

  return (
    <div className={styles.book}>
      <div className={styles.bookBar}>
        <Link to="/genkeys" className={styles.bookBack}>
          ← К колесу
        </Link>
        <span className={styles.bookBarTitle}>Ричард Радд · 64 пути</span>
      </div>

      <div id="gkBookScroll" className={styles.bookScroll}>
        <article className={styles.bookChapter}>
          <header className={styles.bookHead}>
            {key && (
              <Hexagram pattern={key.hexagram} size={40} color="var(--accent)" animate />
            )}
            <div>
              <span className={styles.readingNum}>Глава {n}</span>
              <h1 className={styles.bookTitle}>{title}</h1>
            </div>
          </header>

          {loading && (
            <div className="center" style={{ padding: 'var(--space-8)' }}>
              <Spinner />
            </div>
          )}
          {error && <p className={styles.readingError}>Не удалось загрузить главу.</p>}
          {html && (
            <div
              className={styles.articleBody}
              // Content is the bundled book fragment, sanitized in the hook.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          <nav className={styles.bookNav}>
            {prev ? (
              <button className={styles.bookNavBtn} onClick={() => navigate(`/genkeys/book/${prev}`)}>
                ← Глава {prev}
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button className={styles.bookNavBtn} onClick={() => navigate(`/genkeys/book/${next}`)}>
                Глава {next} →
              </button>
            ) : (
              <span />
            )}
          </nav>
        </article>
      </div>
    </div>
  )
}
