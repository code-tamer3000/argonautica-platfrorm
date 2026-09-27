import { useState } from 'react'
import { useSurveyForm, useSurveyGift } from '../../api/survey'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { downloadFile } from '../../lib/mediaUpload'
import styles from './dashboard.module.css'

/**
 * ARG-157: замена карточки Дневника на главной у выпускника — писать в дневник
 * больше нельзя (см. `journal_locked` в GET /api/dashboard), поэтому на её месте
 * кнопка скачивания того же подарочного PDF, что и в ЛК (`SurveyGiftSection.tsx`,
 * `useSurveyGift`/`downloadFile` — переиспользованы как есть, книга не новая
 * сущность).
 */
export function ExpeditionArtifactCard() {
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
