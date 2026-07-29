import { useCallback, useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import {
  useSubmitSurvey,
  useSurveyForm,
  type SurveyAnswer,
  type SurveyAnswers,
  type SurveyQuestion,
} from '../../api/survey'
import { useAuth } from '../auth/AuthContext'
import { SurveyDone } from './SurveyDone'
import styles from './survey.module.css'

// Черновик переживает перезагрузку: анкета длинная, потерять написанное обидно.
const DRAFT_KEY = 'survey:draft:v1'

interface Draft {
  answers: SurveyAnswers
  consent: boolean
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return { answers: {}, consent: false }
    const parsed = JSON.parse(raw) as Partial<Draft>
    return { answers: parsed.answers ?? {}, consent: !!parsed.consent }
  } catch {
    return { answers: {}, consent: false }
  }
}

function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Приватный режим / переполненное хранилище: черновик не критичен.
  }
}

/**
 * Ошибки формы — те же правила, что и на бэкенде (`validate_answers`), чтобы
 * человек не отправлял анкету в 422. Пустой массив — можно отправлять.
 */
function formErrors(questions: SurveyQuestion[], answers: SurveyAnswers): string[] {
  const errors: string[] = []
  for (const q of questions) {
    const a = answers[q.key]
    if (q.kind === 'multi') {
      if (q.required && !(a?.choices ?? []).length) {
        errors.push(`«${q.title}» — отметь хотя бы один вариант`)
        continue
      }
      if (q.comment_required && (a?.choices ?? []).length && !(a?.comment ?? '').trim()) {
        errors.push(`«${q.comment_title ?? q.title}» — без ответа`)
      }
      continue
    }
    const text = (a?.text ?? '').trim()
    if (!text) {
      if (q.required) errors.push(`«${q.title}» — без ответа`)
      continue
    }
    if (q.required && text.length < q.min_length) {
      errors.push(`«${q.title}» — минимум ${q.min_length} символов`)
    }
  }
  return errors
}

interface QuestionProps {
  q: SurveyQuestion
  answer: SurveyAnswer | undefined
  onChange: (patch: SurveyAnswer) => void
}

function MultiInput({ q, answer, onChange }: QuestionProps) {
  const chosen = answer?.choices ?? []
  return (
    <div className={styles.choices}>
      {q.options.map((o) => {
        const on = chosen.includes(o.key)
        return (
          <button
            key={o.key}
            type="button"
            className={`${styles.choice} ${on ? styles.choiceOn : ''}`}
            aria-pressed={on}
            onClick={() =>
              onChange({
                choices: on ? chosen.filter((k) => k !== o.key) : [...chosen, o.key],
              })
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function TextInput({ q, answer, onChange }: QuestionProps) {
  const text = answer?.text ?? ''
  const short = q.required && q.min_length > 0 && text.trim().length < q.min_length
  return (
    <>
      <textarea
        className={styles.textarea}
        value={text}
        maxLength={q.max_length}
        placeholder={q.placeholder ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      {q.required && q.min_length > 0 && (
        <span className={`${styles.counter} ${short ? styles.counterShort : ''}`}>
          {text.trim().length} / {q.min_length} символов минимум
        </span>
      )}
    </>
  )
}

function QuestionField({ q, answer, onChange }: QuestionProps) {
  const patch = useCallback(
    (next: SurveyAnswer) => onChange({ ...answer, ...next }),
    [answer, onChange],
  )
  return (
    <div className={styles.question}>
      <span className={styles.qTitle}>
        {q.title}
        {q.required && <span className={styles.required}> *</span>}
      </span>
      {q.hint && <span className={styles.qHint}>{q.hint}</span>}
      {q.kind === 'multi' ? (
        <MultiInput q={q} answer={answer} onChange={patch} />
      ) : (
        <TextInput q={q} answer={answer} onChange={patch} />
      )}
      {q.comment_title && (
        <>
          <span className={styles.qHint}>
            {q.comment_title}
            {q.comment_required && <span className={styles.required}> *</span>}
          </span>
          <textarea
            className={styles.textarea}
            value={answer?.comment ?? ''}
            maxLength={q.max_length}
            onChange={(e) => patch({ comment: e.target.value })}
          />
        </>
      )}
    </div>
  )
}

/**
 * Полноэкранный гейт выпускной анкеты. Рендерится вместо всего приложения, пока
 * `user.survey_required` — точно как экран смены пароля (см. AuthGuard).
 *
 * Форму не хардкодим: канон вопросов приходит с бэкенда (`GET /api/survey/me`),
 * фронт лишь рисует их по `kind`. Анкета одностраничная — все вопросы подряд.
 */
export function SurveyScreen() {
  const { user, refreshMe, logout } = useAuth()
  const { data: form, isLoading } = useSurveyForm()
  const submit = useSubmitSurvey()

  const initial = useMemo(loadDraft, [])
  const [answers, setAnswers] = useState<SurveyAnswers>(initial.answers)
  const [consent, setConsent] = useState(initial.consent)
  const [started, setStarted] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [giftReady, setGiftReady] = useState(false)

  const setAnswer = useCallback(
    (key: string, patch: SurveyAnswer) => {
      setAnswers((prev) => {
        const next = { ...prev, [key]: patch }
        saveDraft({ answers: next, consent })
        return next
      })
    },
    [consent],
  )

  if (isLoading || !form) {
    return (
      <div className={styles.screen}>
        <Spinner size={32} />
      </div>
    )
  }

  if (done) {
    return <SurveyDone giftAvailable={giftReady} onEnter={() => void refreshMe()} />
  }

  async function onSubmit() {
    if (!form) return
    const problems = formErrors(form.questions, answers)
    if (problems.length) {
      setErrors(problems)
      return
    }
    try {
      const res = await submit.mutateAsync({ answers, publish_consent: consent })
      localStorage.removeItem(DRAFT_KEY)
      setGiftReady(res.gift_available)
      setDone(true)
      // Флаг снят на сервере — обновляем профиль, иначе гейт вернётся при перезагрузке.
      await refreshMe()
    } catch {
      setErrors(['Не удалось отправить анкету. Попробуй ещё раз.'])
    }
  }

  if (!started) {
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <div className={styles.wordmark}>{form.title}</div>
          <div className={styles.subtitle}>{form.subtitle}</div>
          <p className={styles.intro}>{form.intro}</p>
          <Button type="button" variant="gold" onClick={() => setStarted(true)}>
            Начать
          </Button>
          <Button type="button" variant="outline" onClick={() => void logout()}>
            Выйти
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.wordmark}>{form.title}</div>
        <div className={styles.subtitle}>{form.subtitle}</div>

        <div className={styles.questions}>
          {form.questions.map((q) => (
            <QuestionField
              key={q.key}
              q={q}
              answer={answers[q.key]}
              onChange={(patch) => setAnswer(q.key, patch)}
            />
          ))}
        </div>

        <label className={styles.consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => {
              setConsent(e.target.checked)
              saveDraft({ answers, consent: e.target.checked })
            }}
          />
          {form.consent_label}
        </label>

        {errors.map((e) => (
          <div key={e} className={styles.error}>
            {e}
          </div>
        ))}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="gold"
            disabled={submit.isPending}
            onClick={() => void onSubmit()}
          >
            {submit.isPending ? 'Отправка…' : 'Отправить и получить книгу'}
          </Button>
        </div>
        {user && <span className={styles.qHint}>{user.display_name}</span>}
      </div>
    </div>
  )
}
