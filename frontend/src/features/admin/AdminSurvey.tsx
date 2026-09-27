import { useMemo, useRef, useState } from 'react'
import {
  useAdminSurvey,
  useCancelSurveyInvite,
  useInviteSurvey,
  useSetSurveyGift,
  type SurveyAnswer,
  type SurveyQuestion,
  type SurveyRow,
} from '../../api/survey'
import { useAdminIntakes } from '../../api/admin'
import { useAdminPlans } from '../../api/plans'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { PageHeader } from '../../components/PageHeader'
import { Segmented } from '../../components/Segmented'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import styles from './admin.module.css'

type Tab = 'invite' | 'answers'
type AnswerView = 'byPerson' | 'byQuestion'
/** Ключ тарифа в чекбокс-фильтре: id тарифа либо 'none' — держатель без тарифа. */
type PlanKey = number | 'none'
type IntakeFilter = number | 'all'

/** Пустой набор — фильтр не сужен, показываем все тарифы (как раньше «Все тарифы»). */
function matchesPlan(row: SurveyRow, selected: Set<PlanKey>): boolean {
  if (selected.size === 0) return true
  return selected.has(row.plan_id ?? 'none')
}

function matchesIntake(row: SurveyRow, filter: IntakeFilter): boolean {
  return filter === 'all' || row.intake_id === filter
}

/** `YYYY-MM-DD` → «2 июня 2026» — та же дата, что и в фильтре набора AdminUsers. */
function formatIntakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDatetime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** Ответ одним человекочитаемым куском — по типу вопроса из канона. */
function renderAnswer(q: SurveyQuestion, a: SurveyAnswer): string {
  if (q.kind === 'text') return a.text ?? '—'
  const labels = (a.choices ?? []).map(
    (key) => q.options.find((o) => o.key === key)?.label ?? key,
  )
  const picked = labels.join(', ') || '—'
  return a.comment ? `${picked}\n${a.comment}` : picked
}

/**
 * Выпускная анкета в панели админа: кому её показать и что люди ответили.
 *
 * Подписи вопросов приходят вместе с данными (`form` в ответе бэкенда) — своей
 * копии канона у фронта нет, иначе она разъедется с бэкендом при правке вопросов.
 */
export function AdminSurvey() {
  const [tab, setTab] = useState<Tab>('invite')
  const [answerView, setAnswerView] = useState<AnswerView>('byPerson')
  const [q, setQ] = useState('')
  // null — фильтр не трогали: по умолчанию активный поток, тот же приём, что в
  // AdminUsers/AdminDynamics («Наборы приходят свежими сверху»).
  const [intakeFilter, setIntakeFilter] = useState<IntakeFilter | null>(null)
  const [planFilter, setPlanFilter] = useState<Set<PlanKey>>(new Set())
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [uploading, setUploading] = useState<number | null>(null)
  // Скрытый input на всю таблицу: помним, для кого выбираем файл.
  const fileRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<number | null>(null)

  const { data, isLoading } = useAdminSurvey()
  const { data: intakes = [] } = useAdminIntakes()
  const { data: plansRaw = [] } = useAdminPlans()
  const invite = useInviteSurvey()
  const cancelInvite = useCancelSurveyInvite()
  const setGift = useSetSurveyGift()

  // Наборы приходят свежими сверху: активный — тот, что стартует последним.
  const activeIntake = intakes[0]
  const selectedIntake: IntakeFilter = intakeFilter ?? activeIntake?.id ?? 'all'

  // Самый дешёвый тариф («Наблюдатель») почти никогда не сдаёт анкету — не даём
  // ему занимать верх списка, тот же приём, что и в ростере контактов (`is_cheap`).
  const plans = useMemo(
    () => plansRaw.slice().sort((a, b) => Number(a.is_cheap) - Number(b.is_cheap)),
    [plansRaw],
  )

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        matchesIntake(r, selectedIntake) &&
        matchesPlan(r, planFilter) &&
        (!needle ||
          r.display_name.toLowerCase().includes(needle) ||
          r.username.toLowerCase().includes(needle)),
    )
  }, [rows, q, selectedIntake, planFilter])

  function togglePlan(key: PlanKey) {
    setPlanFilter((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggle(userId: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleAll() {
    // Приглашать имеет смысл только тех, кто ещё не сдал.
    const candidates = filtered.filter((r) => !r.completed_at).map((r) => r.user_id)
    setPicked((prev) =>
      candidates.every((id) => prev.has(id)) ? new Set() : new Set(candidates),
    )
  }

  function selectAllInPlan() {
    if (planFilter.size === 0) return
    const candidates = filtered.filter((r) => !r.completed_at).map((r) => r.user_id)
    setPicked((prev) => new Set([...prev, ...candidates]))
  }

  function handleInvite() {
    invite.mutate([...picked], {
      onSuccess: () => {
        toast(`Анкета показана: ${picked.size}`)
        setPicked(new Set())
      },
      onError: (err: unknown) =>
        toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  function pickGiftFile(userId: number) {
    targetRef.current = userId
    fileRef.current?.click()
  }

  async function handleGiftFiles(files: FileList) {
    const single = targetRef.current
    targetRef.current = null
    // Мультизагрузка: сопоставляем книгу с участником по имени файла
    // (`<username>.pdf` — так их и раскладывает генератор артефактов).
    const jobs: { userId: number; file: File }[] = []
    for (const file of Array.from(files)) {
      if (single !== null && files.length === 1) {
        jobs.push({ userId: single, file })
        continue
      }
      const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()
      const row = rows.find((r) => r.username.toLowerCase() === base)
      if (!row) {
        toast(`Не нашёл участника для файла ${file.name}`, 'error')
        continue
      }
      jobs.push({ userId: row.user_id, file })
    }

    for (const job of jobs) {
      setUploading(job.userId)
      try {
        const { asset } = await mediaUpload(job.file)
        await setGift.mutateAsync({ userId: job.userId, assetId: asset.id })
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось загрузить книгу', 'error')
      } finally {
        setUploading(null)
      }
    }
    toast('Книги привязаны')
  }

  if (isLoading || !data) {
    return (
      <div className={styles.page}>
        <Spinner />
      </div>
    )
  }

  const questions = data.form.questions

  return (
    <div className={styles.page}>
      <PageHeader title="Анкета">
        <span className={styles.listMeta}>
          Показана: {data.invited_count} · Сдали: {data.completed_count}
        </span>
      </PageHeader>

      <Segmented
        options={[
          { value: 'invite', label: 'Кому показать' },
          { value: 'answers', label: `Ответы (${data.completed_count})` },
        ]}
        value={tab}
        onChange={setTab}
        label="Раздел анкеты"
      />

      {tab === 'invite' ? (
        <>
          <p className={styles.listDescription}>
            Отмеченным участникам платформа закроется анкетой до тех пор, пока они её
            не отправят. После отправки человек получает свою книгу экспедиции — её
            нужно загрузить здесь же (файлы вида <code>username.pdf</code> можно
            выбрать пачкой, они разложатся по именам).
          </p>

          <div className={styles.filterRow}>
            <div className={styles.formRow}>
              <label htmlFor="survey_search">Поиск</label>
              <input
                id="survey_search"
                className={styles.input}
                placeholder="По имени или username"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="survey_intake">Поток</label>
              <select
                id="survey_intake"
                className={styles.input}
                value={String(selectedIntake)}
                onChange={(e) =>
                  setIntakeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
              >
                {intakes.map((intake) => (
                  <option key={intake.id} value={intake.id}>
                    {formatIntakeDate(intake.starts_on)}
                    {intake.id === activeIntake?.id ? ' — активный' : ''}
                  </option>
                ))}
                <option value="all">Все потоки</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label>Тариф</label>
              <div className={styles.checkRow}>
                {plans.map((plan) => (
                  <label key={plan.id} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={planFilter.has(plan.id)}
                      onChange={() => togglePlan(plan.id)}
                    />
                    {plan.name}
                  </label>
                ))}
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={planFilter.has('none')}
                    onChange={() => togglePlan('none')}
                  />
                  Без тарифа
                </label>
              </div>
            </div>
          </div>

          <div className={styles.listActions}>
            <Button variant="outline" onClick={toggleAll}>
              Выбрать всех несдавших
            </Button>
            <Button
              variant="outline"
              disabled={planFilter.size === 0}
              onClick={selectAllInPlan}
            >
              Выбрать всех в тарифе
            </Button>
            <Button
              variant="gold"
              disabled={picked.size === 0 || invite.isPending}
              onClick={handleInvite}
            >
              Показать анкету ({picked.size})
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              Загрузить книги пачкой
            </Button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handleGiftFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <div className={styles.list}>
            {filtered.map((r) => (
              <div className={styles.listItem} key={r.user_id}>
                <div className={styles.listItemMain}>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={picked.has(r.user_id)}
                      disabled={!!r.completed_at}
                      onChange={() => toggle(r.user_id)}
                    />
                    <span>
                      {r.display_name}{' '}
                      <span className={styles.listMeta}>@{r.username}</span>
                    </span>
                  </label>
                </div>
                <div className={styles.listActions}>
                  {r.completed_at ? (
                    <Badge tone="accent">
                      Сдал · {formatDatetime(r.completed_at)}
                    </Badge>
                  ) : r.invited ? (
                    <Badge>Ждём анкету</Badge>
                  ) : null}
                  <Badge tone={r.has_gift ? 'accent' : 'neutral'}>
                    {r.has_gift ? 'Книга привязана' : 'Книги нет'}
                  </Badge>
                  <Button
                    variant="outline"
                    disabled={uploading === r.user_id}
                    onClick={() => pickGiftFile(r.user_id)}
                  >
                    {uploading === r.user_id ? 'Загрузка…' : 'Книга…'}
                  </Button>
                  {r.invited && !r.completed_at && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        cancelInvite.mutate(r.user_id, {
                          onSuccess: () => toast('Блокировка снята'),
                        })
                      }
                    >
                      Снять
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={styles.filterRow}>
            <div className={styles.formRow}>
              <label htmlFor="answers_search">Поиск</label>
              <input
                id="answers_search"
                className={styles.input}
                placeholder="По имени или username"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="answers_intake">Поток</label>
              <select
                id="answers_intake"
                className={styles.input}
                value={String(selectedIntake)}
                onChange={(e) =>
                  setIntakeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                }
              >
                {intakes.map((intake) => (
                  <option key={intake.id} value={intake.id}>
                    {formatIntakeDate(intake.starts_on)}
                    {intake.id === activeIntake?.id ? ' — активный' : ''}
                  </option>
                ))}
                <option value="all">Все потоки</option>
              </select>
            </div>
            <div className={styles.formRow}>
              <label>Тариф</label>
              <div className={styles.checkRow}>
                {plans.map((plan) => (
                  <label key={plan.id} className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={planFilter.has(plan.id)}
                      onChange={() => togglePlan(plan.id)}
                    />
                    {plan.name}
                  </label>
                ))}
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={planFilter.has('none')}
                    onChange={() => togglePlan('none')}
                  />
                  Без тарифа
                </label>
              </div>
            </div>
          </div>

          <Segmented
            options={[
              { value: 'byPerson', label: 'По человеку' },
              { value: 'byQuestion', label: 'По вопросу' },
            ]}
            value={answerView}
            onChange={setAnswerView}
            label="Вид ответов"
          />

          {answerView === 'byPerson' ? (
            <div className={styles.list}>
              {filtered.filter((r) => r.completed_at).length === 0 ? (
                <p className={styles.mediaEmpty}>Никто из отфильтрованных пока не заполнил анкету.</p>
              ) : (
                filtered
                  .filter((r) => r.completed_at)
                  .map((r) => <AnswerCard key={r.user_id} row={r} questions={questions} />)
              )}
            </div>
          ) : (
            <div className={styles.list}>
              {questions.map((question) => {
                const answered = filtered.filter(
                  (r) => r.completed_at && r.answers?.[question.key],
                )
                if (answered.length === 0) return null
                return (
                  <div className={`${styles.listItem} ${styles.answerGroup}`} key={question.key}>
                    <h3 className={styles.answerGroupTitle}>{question.title}</h3>
                    {answered.map((r) => (
                      <div className={styles.answerGroupRow} key={r.user_id}>
                        <span className={styles.listMeta}>{r.display_name}</span>
                        <div className={styles.answerText}>
                          {renderAnswer(question, r.answers![question.key])}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AnswerCard({ row, questions }: { row: SurveyRow; questions: SurveyQuestion[] }) {
  return (
    <div className={`${styles.listItem} ${styles.answerCard}`}>
      <span className={styles.listMeta}>
        {row.display_name} · @{row.username} ·{' '}
        {row.completed_at ? formatDatetime(row.completed_at) : ''}
        {row.publish_consent && (
          <>
            {' '}
            <Badge tone="accent">Разрешил публикацию</Badge>
          </>
        )}
      </span>
      {questions.map((q) => {
        const a = row.answers?.[q.key]
        if (!a) return null
        return (
          <div className={styles.answerQA} key={q.key}>
            <div className={styles.answerQuestion}>{q.title}</div>
            <div className={styles.answerText}>{renderAnswer(q, a)}</div>
          </div>
        )
      })}
    </div>
  )
}
