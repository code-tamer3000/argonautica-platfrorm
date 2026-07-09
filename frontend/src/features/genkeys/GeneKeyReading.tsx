import { useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Hexagram } from './Hexagram'
import { useGeneKeyBody } from './useGeneKeyBody'
import { getKey } from './wheel'
import { useGenkeysBookLink } from './useGenkeysBook'
import { IconBook } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import styles from './genkeys.module.css'

interface Props {
  number: number
  onClose: () => void
}

// The body markdown heads each spectrum band with an H2 of exactly this text;
// clicking a spectrum cell scrolls the article to the matching section.
type Band = 'Тень' | 'Дар' | 'Сиддхи'

export function GeneKeyReading({ number, onClose }: Props) {
  const key = getKey(number)
  const { html, loading, error } = useGeneKeyBody(number)
  // If the «64 пути» book (a KB article with an attached .md) is published, link
  // into it: chapter N contemplates key N, so we jump there via ?ch=N.
  const bookLink = useGenkeysBookLink('64 пути')

  // The whole panel is one scroll container; clicking a spectrum band scrolls
  // it to that band's H2 in the rendered markdown body. The heading is tagged
  // `id="gk-band-<band>"` in useGeneKeyBody and carries a scroll-margin so it
  // clears the sticky bar (heading stays visible, not hidden under it).
  const bodyRef = useRef<HTMLDivElement>(null)
  const scrollToBand = useCallback((band: Band) => {
    const head = bodyRef.current?.querySelector(`#gk-band-${band}`)
    head?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (!key) return null

  return (
    <aside className={styles.reading} aria-label={`Генный замок ${number}`}>
      {/* Sticky compact bar: stays pinned as everything scrolls under it, so
          the essential "which key" is always visible without eating the screen. */}
      <div className={styles.readingBar}>
        <Hexagram key={key.number} pattern={key.hexagram} size={26} color="var(--accent)" animate shimmer />
        <div className={styles.readingBarTitle}>
          <span className={styles.readingNum}>Генный замок {key.number}</span>
          <span className={styles.readingBarName}>{key.name}</span>
        </div>
        <button className={styles.readingClose} onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>

      {/* Everything below scrolls together with the article. */}
      <div className={styles.readingScroll}>
        <h1 className={styles.readingName}>{key.name}</h1>

        {/* Deep-link into the «64 пути» book — up top so it's the first offer,
            not buried under the whole reading. Chapter N contemplates key N. */}
        {bookLink && (
          <Link
            to={`/kb/read/${bookLink.itemId}/${bookLink.assetId}?ch=${number}`}
            className={styles.bookLink}
          >
            <IconBook size={16} /> Читать главу в книге «64 пути» →
          </Link>
        )}

        {/* Each band is a button that scrolls the article to its section. */}
        <div className={styles.spectrum}>
          <button
            type="button"
            className={`${styles.spectrumCell} ${styles.cellShadow}`}
            onClick={() => scrollToBand('Тень')}
          >
            <span className={styles.spectrumLabel}>Тень</span>
            <span className={styles.spectrumValue}>{key.shadow}</span>
            {key.fear && <span className={styles.spectrumTotem}>{key.fear}</span>}
          </button>
          <button
            type="button"
            className={`${styles.spectrumCell} ${styles.cellGift}`}
            onClick={() => scrollToBand('Дар')}
          >
            <span className={styles.spectrumLabel}>Дар</span>
            <span className={styles.spectrumValue}>{key.gift}</span>
            {key.life && <span className={styles.spectrumTotem}>{key.life}</span>}
          </button>
          <button
            type="button"
            className={`${styles.spectrumCell} ${styles.cellSiddhi}`}
            onClick={() => scrollToBand('Сиддхи')}
          >
            <span className={styles.spectrumLabel}>Сиддхи</span>
            <span className={styles.spectrumValue}>{key.siddhi}</span>
            {key.vision && <span className={styles.spectrumTotem}>{key.vision}</span>}
          </button>
        </div>

        <dl className={styles.chars}>
          <Char label="Аминокислота" value={key.aminoAcid} />
          <Char label="Кодоновое кольцо" value={ringLabel(key.codonRing, key.codonRingMembers)} />
          <Char label="Физиология" value={key.physiology} />
          <Char label="Программный партнёр" value={key.partner} />
          <Char label="Дилемма" value={key.dilemma} />
          <Char label="Паттерн жертвы" value={key.victim} />
        </dl>

        {loading && (
          <div className="center" style={{ padding: 'var(--space-6)' }}>
            <Spinner />
          </div>
        )}
        {error && <p className={styles.readingError}>Не удалось загрузить текст замка.</p>}
        {html && (
          <div
            ref={bodyRef}
            className={styles.articleBody}
            // Content is bundled markdown, sanitized in the hook.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </aside>
  )
}

function Char({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className={styles.charRow}>
      <dt className={styles.charLabel}>{label}</dt>
      <dd className={styles.charValue}>{value}</dd>
    </div>
  )
}

function ringLabel(name: string, members: number[]): string {
  if (!name) return ''
  if (!members.length) return name
  return `${name} (${members.join(', ')})`
}
