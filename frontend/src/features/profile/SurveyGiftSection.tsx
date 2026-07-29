import { useState } from 'react'
import { useSurveyForm, useSurveyGift } from '../../api/survey'
import { Button } from '../../components/Button'
import { downloadFile } from '../../lib/mediaUpload'
import styles from './profile.module.css'

/**
 * Подарок за выпускную анкету — личная книга экспедиции, доступная в ЛК.
 *
 * Экран благодарности после отправки показывается ровно один раз, поэтому кнопка
 * нужна и здесь: закрыл вкладку не скачав — книга должна остаться под рукой.
 * Заодно это единственное место, где человек увидит книгу, привязанную админом
 * уже ПОСЛЕ того, как он сдал анкету.
 */
export function SurveyGiftSection() {
  const { data: form } = useSurveyForm()
  const gift = useSurveyGift()
  const [error, setError] = useState<string | null>(null)

  // Анкета не сдана — гейт покажет её сам, в профиле ей делать нечего.
  if (!form?.completed_at) return null

  async function onDownload() {
    setError(null)
    try {
      const { url, filename } = await gift.mutateAsync()
      await downloadFile(url, filename)
    } catch {
      setError('Не получилось скачать книгу. Попробуй ещё раз или напиши в поддержку.')
    }
  }

  return (
    <div className={styles.settingCard}>
      <h2 className={styles.settingTitle}>Книга экспедиции</h2>
      {form.gift_available ? (
        <>
          <p className={styles.giftText}>
            Весь твой путь в одном артефакте: дневник по дням, ответы на задания и
            Генные Замки по стихиям.
          </p>
          <Button variant="gold" disabled={gift.isPending} onClick={() => void onDownload()}>
            {gift.isPending ? 'Готовим…' : 'Скачать книгу (PDF)'}
          </Button>
          {error && <p className={styles.giftError}>{error}</p>}
        </>
      ) : (
        <p className={styles.giftText}>
          Твоя книга ещё собирается — она появится здесь, как только будет готова.
        </p>
      )}
    </div>
  )
}
