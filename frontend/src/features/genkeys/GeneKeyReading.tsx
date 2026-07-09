import { Hexagram } from './Hexagram'
import { useGeneKeyBody } from './useGeneKeyBody'
import { getKey } from './wheel'
import { Spinner } from '../../components/Spinner'
import styles from './genkeys.module.css'

interface Props {
  number: number
  onClose: () => void
}

export function GeneKeyReading({ number, onClose }: Props) {
  const key = getKey(number)
  const { html, loading, error } = useGeneKeyBody(number)

  if (!key) return null

  return (
    <aside className={styles.reading} aria-label={`Генный замок ${number}`}>
      {/* Sticky compact bar: stays pinned as everything scrolls under it, so
          the essential "which key" is always visible without eating the screen. */}
      <div className={styles.readingBar}>
        <Hexagram key={key.number} pattern={key.hexagram} size={26} color="var(--accent)" animate />
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

        <div className={styles.spectrum}>
          <div className={`${styles.spectrumCell} ${styles.cellShadow}`}>
            <span className={styles.spectrumLabel}>Тень</span>
            <span className={styles.spectrumValue}>{key.shadow}</span>
            {key.fear && <span className={styles.spectrumTotem}>{key.fear}</span>}
          </div>
          <div className={`${styles.spectrumCell} ${styles.cellGift}`}>
            <span className={styles.spectrumLabel}>Дар</span>
            <span className={styles.spectrumValue}>{key.gift}</span>
            {key.life && <span className={styles.spectrumTotem}>{key.life}</span>}
          </div>
          <div className={`${styles.spectrumCell} ${styles.cellSiddhi}`}>
            <span className={styles.spectrumLabel}>Сиддхи</span>
            <span className={styles.spectrumValue}>{key.siddhi}</span>
            {key.vision && <span className={styles.spectrumTotem}>{key.vision}</span>}
          </div>
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
