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
    <aside className={styles.reading} aria-label={`Генный Ключ ${number}`}>
      <div className={styles.readingHead}>
        <div className={styles.readingHeadTop}>
          <div className={styles.readingHex}>
            <Hexagram pattern={key.hexagram} size={40} color="var(--accent)" />
          </div>
          <div className={styles.readingTitleWrap}>
            <span className={styles.readingNum}>Генный Ключ {key.number}</span>
            <h1 className={styles.readingName}>{key.name}</h1>
          </div>
          <button className={styles.readingClose} onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>

        {/* Spectrum triad */}
        <div className={styles.spectrum}>
          <div className={`${styles.spectrumCell} ${styles.cellShadow}`}>
            <span className={styles.spectrumLabel}>Тень</span>
            <span className={styles.spectrumValue}>{key.shadow}</span>
          </div>
          <div className={`${styles.spectrumCell} ${styles.cellGift}`}>
            <span className={styles.spectrumLabel}>Дар</span>
            <span className={styles.spectrumValue}>{key.gift}</span>
          </div>
          <div className={`${styles.spectrumCell} ${styles.cellSiddhi}`}>
            <span className={styles.spectrumLabel}>Сиддхи</span>
            <span className={styles.spectrumValue}>{key.siddhi}</span>
          </div>
        </div>

        {/* Characteristics chips */}
        <dl className={styles.chars}>
          <Char label="Аминокислота" value={key.aminoAcid} />
          <Char label="Кодоновое кольцо" value={ringLabel(key.codonRing, key.codonRingMembers)} />
          <Char label="Физиология" value={key.physiology} />
          <Char label="Программный партнёр" value={key.partner} />
          <Char label="Дилемма" value={key.dilemma} />
          <Char label="Паттерн жертвы" value={key.victim} />
        </dl>
      </div>

      <div className={styles.readingBody}>
        {loading && (
          <div className="center" style={{ padding: 'var(--space-6)' }}>
            <Spinner />
          </div>
        )}
        {error && <p className={styles.readingError}>Не удалось загрузить текст ключа.</p>}
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
