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
import { ApiError, isNetworkError } from '../../lib/apiClient'
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
 * человек не отправлял анкету в 422. По ключу вопроса — подсказка рисуется
 * прямо под конкретным полем, а не общим списком; отдельный ключ `${key}:comment`
 * для поля отписки у multi-вопроса. Пустой объект — можно отправлять.
 */
function formErrors(
  questions: SurveyQuestion[],
  answers: SurveyAnswers,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const q of questions) {
    const a = answers[q.key]
    if (q.kind === 'multi') {
      if (q.required && !(a?.choices ?? []).length) {
        errors[q.key] = 'Отметь хотя бы один вариант'
        continue
      }
      if (q.comment_required && (a?.choices ?? []).length && !(a?.comment ?? '').trim()) {
        errors[`${q.key}:comment`] = 'Это поле пропущено'
      }
      continue
    }
    const text = (a?.text ?? '').trim()
    if (!text) {
      if (q.required) errors[q.key] = 'Это поле пропущено'
      continue
    }
    if (q.required && text.length < q.min_length) {
      errors[q.key] = `Напиши ещё немного — нужно минимум ${q.min_length} символов`
    }
  }
  return errors
}

/**
 * Внятная причина вместо «попробуй ещё раз»: анкета сдаётся один раз, и человек,
 * упёршийся в глухую ошибку, остаётся заперт на этом экране — он должен понимать,
 * что происходит, а поддержка — что чинить.
 */
function submitErrorText(err: unknown): string {
  if (isNetworkError(err)) {
    return 'Нет связи с сервером. Ответы сохранены — попробуй ещё раз.'
  }
  if (err instanceof ApiError) {
    if (err.status === 409) {
      return 'Эта анкета уже отправлена. Обнови страницу — платформа откроется.'
    }
    if (err.status === 401 || err.status === 403) {
      return 'Сессия истекла. Зайди заново — ответы сохранены.'
    }
    if (err.status === 422) {
      return `Ответы не приняты: ${err.detail}`
    }
    return `Не удалось отправить анкету (ошибка ${err.status}). Ответы сохранены.`
  }
  return 'Не удалось отправить анкету. Ответы сохранены — попробуй ещё раз.'
}

interface QuestionProps {
  q: SurveyQuestion
  answer: SurveyAnswer | undefined
  onChange: (patch: SurveyAnswer) => void
  /** Подсказка под полем — только после неудачной попытки отправки, не «на лету». */
  error?: string
}

function MultiInput({ q, answer, onChange, error }: QuestionProps) {
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
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  )
}

function TextInput({ q, answer, onChange, error }: QuestionProps) {
  const text = answer?.text ?? ''
  return (
    <>
      <textarea
        className={styles.textarea}
        value={text}
        maxLength={q.max_length}
        placeholder={q.placeholder ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
      />
      {error && <span className={styles.fieldError}>{error}</span>}
    </>
  )
}

function QuestionField({
  q,
  answer,
  onChange,
  error,
  commentError,
}: QuestionProps & { commentError?: string }) {
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
        <MultiInput q={q} answer={answer} onChange={patch} error={error} />
      ) : (
        <TextInput q={q} answer={answer} onChange={patch} error={error} />
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
          {commentError && <span className={styles.fieldError}>{commentError}</span>}
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
  // По ключу вопроса — рисуется под конкретным полем, появляется только после
  // неудачной попытки отправки (не «на лету», пока человек ещё печатает).
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
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
    if (Object.keys(problems).length) {
      setFieldErrors(problems)
      setSubmitError(null)
      return
    }
    setFieldErrors({})
    try {
      // Шлём только ключи текущего канона: в черновике из localStorage могут
      // лежать ответы на вопросы, которых в форме уже нет (её переделали между
      // сессиями), а бэкенд бракует неизвестные ключи целиком — 422 на ровном
      // месте, причём экран такой ответ даже не показывает.
      const payload: SurveyAnswers = {}
      for (const q of form.questions) {
        const a = answers[q.key]
        if (a) payload[q.key] = a
      }
      const res = await submit.mutateAsync({ answers: payload, publish_consent: consent })
      localStorage.removeItem(DRAFT_KEY)
      setGiftReady(res.gift_available)
      setDone(true)
      // Флаг снят на сервере — обновляем профиль, иначе гейт вернётся при перезагрузке.
      await refreshMe()
    } catch (err) {
      setSubmitError(submitErrorText(err))
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
              error={fieldErrors[q.key]}
              commentError={fieldErrors[`${q.key}:comment`]}
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

        {Object.keys(fieldErrors).length > 0 && (
          <div className={styles.fieldError}>Проверь отмеченные поля выше</div>
        )}
        {submitError && <div className={styles.error}>{submitError}</div>}

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
