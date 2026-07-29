import { useState } from 'react'
import { Button } from '../../components/Button'
import { useSurveyGift } from '../../api/survey'
import { downloadFile } from '../../lib/mediaUpload'
import styles from './survey.module.css'

interface Props {
  /** Личная книга уже привязана админом — есть что скачать прямо сейчас. */
  giftAvailable: boolean
  /** Уйти на платформу: гейт уже снят, достаточно обновить профиль. */
  onEnter: () => void
}

/**
 * Экран после отправки анкеты: благодарность и подарок — личная книга экспедиции.
 *
 * Скачиваем через `downloadFile`: presigned-ссылка кросс-доменная, прямой
 * `<a download>` её игнорирует, а в iOS-PWA открывается пустая вкладка.
 */
export function SurveyDone({ giftAvailable, onEnter }: Props) {
  const gift = useSurveyGift()
  const [error, setError] = useState<string | null>(null)

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
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.done}>
          <div className={styles.wordmark}>Спасибо</div>
          <p className={styles.doneText}>
            Твои ответы дошли. Они правда влияют на то, каким будет следующий поток.
          </p>

          {giftAvailable ? (
            <div className={styles.gift}>
              <span className={styles.giftTitle}>Твоя книга экспедиции</span>
              <p className={styles.doneText}>
                Весь путь в одном артефакте: дневник по дням, ответы на задания и
                Генные Замки по стихиям — Воздух, Огонь, Вода, Земля.
              </p>
              <Button
                type="button"
                variant="gold"
                disabled={gift.isPending}
                onClick={() => void onDownload()}
              >
                {gift.isPending ? 'Готовим…' : 'Скачать книгу (PDF)'}
              </Button>
              {error && <div className={styles.error}>{error}</div>}
              <span className={styles.qHint}>
                Книга останется в твоём профиле — можно скачать её и позже.
              </span>
            </div>
          ) : (
            <p className={styles.doneText}>
              Твоя личная книга экспедиции ещё собирается — она появится в твоём
              профиле, как только будет готова.
            </p>
          )}

          <Button type="button" variant="outline" onClick={onEnter}>
            Войти на платформу
          </Button>
        </div>
      </div>
    </div>
  )
}
