import { useState } from 'react'
import { useCreateFeedback } from '../../api/feedback'
import { useFaqItems } from '../../api/faq'
import type { FeedbackKind } from '../../lib/types'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Segmented } from '../../components/Segmented'
import { Spinner } from '../../components/Spinner'
import { IconChevronRight } from '../../components/icons'
import { renderMarkdown } from '../../lib/markdown'
import { toast } from '../../stores/toast'
import styles from './support.module.css'

const KIND_LABEL: Record<FeedbackKind, string> = {
  improvement: 'Предложить улучшение',
  bug: 'Сообщить об ошибке',
}

const KIND_OPTIONS = (['improvement', 'bug'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))

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
      <Segmented label="Тип обращения" options={KIND_OPTIONS} value={kind} onChange={setKind} />
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
    return <EmptyState>Пока нет ответов на частые вопросы.</EmptyState>
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
            {open && (
              <div
                className={`${styles.faqAnswer} ${styles.markdown}`}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(item.answer) }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SupportScreen() {
  return (
    <div className={styles.page}>
      <PageHeader title="Техподдержка" />

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
