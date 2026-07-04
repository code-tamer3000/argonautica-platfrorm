import { useState } from 'react'
import { useCreateFeedback } from '../../api/feedback'
import { useFaqItems } from '../../api/faq'
import type { FeedbackKind } from '../../lib/types'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { IconChevronRight } from '../../components/icons'
import { toast } from '../../stores/toast'
import styles from './support.module.css'

const KIND_LABEL: Record<FeedbackKind, string> = {
  improvement: 'Предложить улучшение',
  bug: 'Сообщить об ошибке',
}

const KIND_PLACEHOLDER: Record<FeedbackKind, string> = {
  improvement: 'Опишите, что и как стоит улучшить…',
  bug: 'Что сломалось? Что вы делали до этого? Чего ожидали?',
}

function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>('improvement')
  const [body, setBody] = useState('')
  const createFeedback = useCreateFeedback()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    createFeedback.mutate(
      { kind, body: text },
      {
        onSuccess: () => {
          toast('Спасибо, обращение отправлено')
          setBody('')
        },
        onError: (err: unknown) =>
          toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.segmented} role="tablist">
        {(['improvement', 'bug'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? styles.segActive : styles.seg}
            onClick={() => setKind(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        className={styles.textarea}
        rows={5}
        maxLength={4000}
        placeholder={KIND_PLACEHOLDER[kind]}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className={styles.formActions}>
        <Button type="submit" disabled={!body.trim() || createFeedback.isPending}>
          {createFeedback.isPending ? 'Отправка…' : 'Отправить'}
        </Button>
      </div>
    </form>
  )
}

function FaqSection() {
  const { data: items, isLoading } = useFaqItems()
  const [openId, setOpenId] = useState<number | null>(null)

  if (isLoading) return <Spinner />
  if (!items || items.length === 0) {
    return <p className={styles.empty}>Пока нет ответов на частые вопросы.</p>
  }

  return (
    <div className={styles.faqList}>
      {items.map((item) => {
        const open = openId === item.id
        return (
          <div className={styles.faqItem} key={item.id}>
            <button
              className={styles.faqQuestion}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : item.id)}
            >
              <span className={open ? styles.faqChevronOpen : styles.faqChevron}>
                <IconChevronRight size={18} />
              </span>
              <span>{item.question}</span>
            </button>
            {open && <div className={styles.faqAnswer}>{item.answer}</div>}
          </div>
        )
      })}
    </div>
  )
}

export function SupportScreen() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Техподдержка</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Обратная связь</h2>
        <p className={styles.sectionHint}>
          Предложите улучшение или сообщите об ошибке — обращение увидит команда
          платформы.
        </p>
        <FeedbackForm />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Частые вопросы</h2>
        <FaqSection />
      </section>
    </div>
  )
}
