import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ArtifactGate } from '../../api/dashboard'
import { useSurveyForm, useSurveyGift } from '../../api/survey'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { downloadFile } from '../../lib/mediaUpload'
import styles from './dashboard.module.css'

interface Props {
  /** null — гейта нет (админ не выбрал обязательных заданий потока, ARG-159). */
  gate: ArtifactGate | null
}

/**
 * ARG-157: замена карточки Дневника на главной у выпускника — писать в дневник
 * больше нельзя (см. `journal_locked` в GET /api/dashboard), поэтому на её месте
 * кнопка скачивания того же подарочного PDF, что и в ЛК (`SurveyGiftSection.tsx`,
 * `useSurveyGift`/`downloadFile` — переиспользованы как есть, книга не новая
 * сущность).
 *
 * ARG-159: пока не приняты обязательные задания потока (`gate.pending_tasks`),
 * вместо скачивания — список того, что нужно доздать, каждое со ссылкой на
 * само задание.
 */
export function ExpeditionArtifactCard({ gate }: Props) {
  const { data: form } = useSurveyForm()
  const gift = useSurveyGift()
  const [error, setError] = useState<string | null>(null)

  async function onDownload() {
    setError(null)
    try {
      const { url, filename } = await gift.mutateAsync()
      await downloadFile(url, filename)
    } catch {
      setError('Не получилось скачать артефакт. Попробуй ещё раз или напиши в поддержку.')
    }
  }

  if (gate && !gate.available) {
    return (
      <Card className={styles.today} accent>
        <div className={styles.cardHead}>
          <h3>Артефакт экспедиции</h3>
        </div>
        <p className={styles.headSub}>
          Артефакт откроется, когда будут приняты обязательные задания:
        </p>
        <div className={styles.sections}>
          {gate.pending_tasks.map((t) => (
            <Link key={t.id} to={`/tasks/${t.id}`} className={styles.section}>
              {t.title}
            </Link>
          ))}
        </div>
      </Card>
    )
  }

  return (
    <Card className={styles.today} accent>
      <div className={styles.cardHead}>
        <h3>Артефакт экспедиции</h3>
      </div>
      {form?.gift_available ? (
        <>
          <p className={styles.headSub}>
            Весь твой путь в одном артефакте: дневник по дням, ответы на задания и
            Генные Замки по стихиям.
          </p>
          <Button variant="gold" disabled={gift.isPending} onClick={() => void onDownload()}>
            {gift.isPending ? 'Готовим…' : 'Скачать артефакт (PDF)'}
          </Button>
          {error && <p className={styles.headSub}>{error}</p>}
        </>
      ) : (
        <p className={styles.headSub}>Артефакт ещё собирается — появится здесь, как будет готов.</p>
      )}
    </Card>
  )
}
