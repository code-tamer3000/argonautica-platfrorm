import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import ofertaRaw from './content/oferta.md?raw'
import styles from './oferta.module.css'

/** Публичная оферта (ARG-43) — единственный неавторизованный экран платформы.
 * Открывается из intake-бота Telegram WebApp'ом (`/oferta`), поэтому не проходит
 * через AuthGuard (см. App.tsx) и не тянет ничего из API. */
export function OfertaScreen() {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    setHtml(DOMPurify.sanitize(marked.parse(ofertaRaw) as string))
  }, [])

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <img className={styles.brandMark} src="/media/monogram.png" alt="" aria-hidden />
          <span className={styles.wordmark}>Аргонавтика</span>
        </div>
        {html ? (
          <div className={styles.body} dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}
      </div>
    </div>
  )
}
