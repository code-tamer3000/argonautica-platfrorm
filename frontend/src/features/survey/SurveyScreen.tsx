import { useCallback, useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import {
  useSubmitSurvey,
  useSurveyForm,
  type SurveyAnswer,
  type SurveyAnswers,
  type SurveyForm,
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

/** Пустой ли ответ на вопрос — по нему считаем «шаг не заполнен». */
function isBlank(q: SurveyQuestion, a: SurveyAnswer | undefined): boolean {
  if (!a) return true
  if (q.kind === 'text') return !(a.text ?? '').trim()
  if (q.kind === 'matrix') {
    const values = a.values ?? {}
    return q.options.some((o) => typeof values[o.key] !== 'number')
  }
  return a.value === undefined || a.value === null || a.value === ''
}

/** Ошибки шага. Пустой массив — можно идти дальше. */
function stepErrors(questions: SurveyQuestion[], answers: SurveyAnswers): string[] {
  const errors: string[] = []
  for (const q of questions) {
    const a = answers[q.key]
    if (q.required && isBlank(q, a)) {
      errors.push(
        q.kind === 'matrix' ? `«${q.title}» — оцени каждый формат` : `«${q.title}» — без ответа`,
      )
      continue
    }
    if (q.kind === 'text' && q.required) {
      const text = (a?.text ?? '').trim()
      if (text.length < q.min_length) {
        errors.push(`«${q.title}» — минимум ${q.min_length} символов`)
      }
    }
    if (q.comment_required && !(a?.comment ?? '').trim() && !isBlank(q, a)) {
      errors.push(`«${q.comment_title ?? q.title}» — без ответа`)
    }
  }
  return errors
}

interface QuestionProps {
  q: SurveyQuestion
  answer: SurveyAnswer | undefined
  onChange: (patch: SurveyAnswer) => void
}

function ScaleInput({ q, answer, onChange }: QuestionProps) {
  const values: number[] = []
  for (let v = q.min_value; v <= q.max_value; v += 1) values.push(v)
  return (
    <>
      <div className={styles.scale}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className={`${styles.scaleBtn} ${answer?.value === v ? styles.scaleBtnOn : ''}`}
            onClick={() => onChange({ value: v })}
            aria-pressed={answer?.value === v}
          >
            {v}
          </button>
        ))}
      </div>
      {(q.min_label || q.max_label) && (
        <div className={styles.scaleEnds}>
          <span>{q.min_label}</span>
          <span>{q.max_label}</span>
        </div>
      )}
    </>
  )
}

function ChoiceInput({ q, answer, onChange }: QuestionProps) {
  return (
    <div className={styles.choices}>
      {q.options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`${styles.choice} ${answer?.value === o.key ? styles.choiceOn : ''}`}
          onClick={() => onChange({ value: o.key })}
          aria-pressed={answer?.value === o.key}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function MatrixInput({ q, answer, onChange }: QuestionProps) {
  const values = answer?.values ?? {}
  const scale: number[] = []
  for (let v = q.min_value; v <= q.max_value; v += 1) scale.push(v)
  return (
    <div>
      {q.options.map((o) => (
        <div key={o.key} className={styles.matrixRow}>
          <span className={styles.matrixLabel}>{o.label}</span>
          <div className={styles.matrixScale}>
            {scale.map((v) => (
              <button
                key={v}
                type="button"
                className={`${styles.matrixBtn} ${values[o.key] === v ? styles.matrixBtnOn : ''}`}
                onClick={() => onChange({ values: { ...values, [o.key]: v } })}
                aria-label={`${o.label}: ${v}`}
                aria-pressed={values[o.key] === v}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
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
      {q.min_length > 0 && (
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
      {q.kind === 'scale' && <ScaleInput q={q} answer={answer} onChange={patch} />}
      {q.kind === 'choice' && <ChoiceInput q={q} answer={answer} onChange={patch} />}
      {q.kind === 'matrix' && <MatrixInput q={q} answer={answer} onChange={patch} />}
      {q.kind === 'text' && <TextInput q={q} answer={answer} onChange={patch} />}
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
 * фронт лишь рисует их по `kind`.
 */
export function SurveyScreen() {
  const { user, refreshMe, logout } = useAuth()
  const { data: form, isLoading } = useSurveyForm()
  const submit = useSubmitSurvey()

  const initial = useMemo(loadDraft, [])
  const [answers, setAnswers] = useState<SurveyAnswers>(initial.answers)
  const [consent, setConsent] = useState(initial.consent)
  // -1 — вступительная заставка, дальше индексы шагов.
  const [step, setStep] = useState(-1)
  const [errors, setErrors] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [giftReady, setGiftReady] = useState(false)

  const setAnswer = useCallback((key: string, patch: SurveyAnswer) => {
    setAnswers((prev) => {
      const next = { ...prev, [key]: patch }
      saveDraft({ answers: next, consent })
      return next
    })
  }, [consent])

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

  const stepQuestions = (index: number): SurveyQuestion[] =>
    form.questions.filter((q) => q.step === index + 1)

  async function onSubmit(f: SurveyForm) {
    const problems = stepErrors(stepQuestions(f.steps.length - 1), answers)
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

  if (step < 0) {
    return (
      <div className={styles.screen}>
        <div className={styles.card}>
          <div className={styles.wordmark}>{form.title}</div>
          <div className={styles.subtitle}>{form.subtitle}</div>
          <p className={styles.intro}>{form.intro}</p>
          <Button type="button" variant="gold" onClick={() => setStep(0)}>
            Начать
          </Button>
          <Button type="button" variant="outline" onClick={() => void logout()}>
            Выйти
          </Button>
        </div>
      </div>
    )
  }

  const last = step === form.steps.length - 1
  const questions = stepQuestions(step)

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.steps}>
          {form.steps.map((label, i) => (
            <span
              key={label}
              className={`${styles.stepBar} ${i <= step ? styles.stepBarDone : ''}`}
            />
          ))}
          <span className={styles.stepLabel}>
            {step + 1} / {form.steps.length}
          </span>
        </div>
        <div className={styles.stepTitle}>{form.steps[step]}</div>

        <div className={styles.questions}>
          {questions.map((q) => (
            <QuestionField
              key={q.key}
              q={q}
              answer={answers[q.key]}
              onChange={(patch) => setAnswer(q.key, patch)}
            />
          ))}
        </div>

        {last && (
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
        )}

        {errors.map((e) => (
          <div key={e} className={styles.error}>
            {e}
          </div>
        ))}

        <div className={styles.actions}>
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setErrors([])
                setStep(step - 1)
              }}
            >
              Назад
            </Button>
          )}
          {last ? (
            <Button
              type="button"
              variant="gold"
              disabled={submit.isPending}
              onClick={() => void onSubmit(form)}
            >
              {submit.isPending ? 'Отправка…' : 'Отправить и получить книгу'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="gold"
              onClick={() => {
                const problems = stepErrors(questions, answers)
                setErrors(problems)
                if (!problems.length) setStep(step + 1)
              }}
            >
              Далее
            </Button>
          )}
        </div>
        {user && <span className={styles.qHint}>{user.display_name}</span>}
      </div>
    </div>
  )
}
