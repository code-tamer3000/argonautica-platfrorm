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
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { Badge } from '../../components/Badge'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import cabin from '../cabin/cabin.module.css'
import styles from './admin.module.css'

type Tab = 'invite' | 'answers'

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
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [uploading, setUploading] = useState<number | null>(null)
  // Скрытый input на всю таблицу: помним, для кого выбираем файл.
  const fileRef = useRef<HTMLInputElement>(null)
  const targetRef = useRef<number | null>(null)

  const { data, isLoading } = useAdminSurvey()
  const invite = useInviteSurvey()
  const cancelInvite = useCancelSurveyInvite()
  const setGift = useSetSurveyGift()

  const rows = useMemo(() => data?.rows ?? [], [data])
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (r) =>
        r.display_name.toLowerCase().includes(needle) ||
        r.username.toLowerCase().includes(needle),
    )
  }, [rows, q])

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
      <div className={styles.pageHeader}>
        <h1>Выпускная анкета</h1>
        <span className={styles.listMeta}>
          Показана: {data.invited_count} · Сдали: {data.completed_count}
        </span>
      </div>

      <div className={cabin.segmented} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'invite'}
          className={tab === 'invite' ? cabin.segActive : cabin.seg}
          onClick={() => setTab('invite')}
        >
          Кому показать
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'answers'}
          className={tab === 'answers' ? cabin.segActive : cabin.seg}
          onClick={() => setTab('answers')}
        >
          Ответы ({data.completed_count})
        </button>
      </div>

      {tab === 'invite' ? (
        <>
          <p className={styles.listDescription}>
            Отмеченным участникам платформа закроется анкетой до тех пор, пока они её
            не отправят. После отправки человек получает свою книгу экспедиции — её
            нужно загрузить здесь же (файлы вида <code>username.pdf</code> можно
            выбрать пачкой, они разложатся по именам).
          </p>

          <input
            className={styles.input}
            placeholder="Поиск по имени или username"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className={styles.listActions}>
            <Button variant="outline" onClick={toggleAll}>
              Выбрать всех несдавших
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
        <div className={styles.list}>
          {rows.filter((r) => r.completed_at).length === 0 ? (
            <p className={styles.mediaEmpty}>Пока никто не заполнил анкету.</p>
          ) : (
            rows
              .filter((r) => r.completed_at)
              .map((r) => <AnswerCard key={r.user_id} row={r} questions={questions} />)
          )}
        </div>
      )}
    </div>
  )
}

function AnswerCard({ row, questions }: { row: SurveyRow; questions: SurveyQuestion[] }) {
  return (
    <div className={styles.listItem} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
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
          <div key={q.key} style={{ marginTop: 'var(--space-3)' }}>
            <div className={styles.listMeta}>{q.title}</div>
            <div className={styles.listDescription} style={{ whiteSpace: 'pre-wrap' }}>
              {renderAnswer(q, a)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
