import { useEffect, useState } from 'react'
import {
  useAdminIntakes,
  useCreateIntake,
  useIntakeStages,
  useSetIntakeStages,
  useUpdateIntake,
} from '../../api/admin'
import { useTasks } from '../../api/tasks'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { PageHeader } from '../../components/PageHeader'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import type { IntakeOut, StageIn, StageKind } from '../../lib/types'
import { AdminPlans } from './AdminPlans'
import styles from './admin.module.css'

// Порядок и русские подписи этапов — тот же порядок, что и в раскладке круга
// (app/services/expedition.py STAGE_KINDS): эфир открывает этап, этап идёт до
// эфира следующего.
const STAGE_KINDS: StageKind[] = ['balance', 'air', 'fire', 'water', 'earth', 'final']
const STAGE_LABELS: Record<StageKind, string> = {
  balance: 'Точка баланса',
  air: 'Воздух',
  fire: 'Огонь',
  water: 'Вода',
  earth: 'Земля',
  final: 'Финал',
}

/** `YYYY-MM-DD` → «2 июня 2026». Дата экспедиции — календарная, без часовых поясов. */
function intakeDate(startsOn: string): string {
  return new Date(`${startsOn}T00:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Дефолт для поля «Дата окончания» в форме — не enforced, админ вправе поправить:
// срок жизни экспедиции и 28-дневное окно Динамики — разные величины (ARG-96).
function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Экспедиции (было «Наборы» в разделе «Пользователи», ARG-104): создание потоков,
// тарифы (были отдельной вкладкой — переехали сюда, они привязки к потоку не несут,
// но концептуально это одна «воронка приёма») и ЕДИНСТВЕННЫЙ на всю платформу
// переключатель «текущая экспедиция» — выбор здесь сужает Задачи/КБ/Чаты и целевой
// поток репоста в новости ВЕЗДЕ (см. stores/ui.ts adminCurrentIntakeId), без
// отдельных фильтров/баннеров на каждом экране (были — вызвали жалобы, убраны).
export function AdminExpeditions() {
  const { data: intakes = [] } = useAdminIntakes()
  // Наборы приходят свежими сверху: активный — тот, что стартует последним.
  const activeIntake: IntakeOut | undefined = intakes[0]
  const createIntake = useCreateIntake()
  const updateIntake = useUpdateIntake()

  const currentIntakeId = useUiStore((s) => s.adminCurrentIntakeId)
  const setCurrentIntakeId = useUiStore((s) => s.setAdminCurrentIntakeId)

  // Create expedition modal
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeStartsOn, setIntakeStartsOn] = useState(todayIso())
  const [intakeEndsOn, setIntakeEndsOn] = useState(plusDays(todayIso(), 27))

  // Edit expedition window modal (только ends_on — starts_on без API, см. ARG-89)
  const [editIntakeWindow, setEditIntakeWindow] = useState<IntakeOut | null>(null)
  const [editIntakeEndsOn, setEditIntakeEndsOn] = useState('')

  // Круг Экспедиции: расписание этапов потока
  const [stagesIntake, setStagesIntake] = useState<IntakeOut | null>(null)

  function handleCreateIntake() {
    if (!intakeStartsOn || !intakeEndsOn) return
    createIntake.mutate(
      { starts_on: intakeStartsOn, ends_on: intakeEndsOn },
      {
        onSuccess: (intake) => {
          toast(`Экспедиция от ${intakeDate(intake.starts_on)} создана`)
          setIntakeOpen(false)
          // Только что созданная — логичный дефолт «текущей».
          setCurrentIntakeId(intake.id)
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Ошибка', 'error')
        },
      },
    )
  }

  function handleEditIntakeWindow() {
    if (!editIntakeWindow || !editIntakeEndsOn) return
    updateIntake.mutate(
      { id: editIntakeWindow.id, ends_on: editIntakeEndsOn },
      {
        onSuccess: () => {
          toast('Дата закрытия экспедиции обновлена')
          setEditIntakeWindow(null)
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Ошибка', 'error')
        },
      },
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Экспедиции">
        <Button
          variant="outline"
          onClick={() => {
            const start = todayIso()
            setIntakeStartsOn(start)
            setIntakeEndsOn(plusDays(start, 27))
            setIntakeOpen(true)
          }}
        >
          Новая экспедиция
        </Button>
      </PageHeader>

      <div className={styles.formRow} style={{ maxWidth: 420 }}>
        <label htmlFor="current_expedition">Текущая экспедиция</label>
        <select
          id="current_expedition"
          className={styles.input}
          value={currentIntakeId ?? 'all'}
          onChange={(e) =>
            setCurrentIntakeId(e.target.value === 'all' ? null : Number(e.target.value))
          }
        >
          <option value="all">Все экспедиции</option>
          {intakes.map((intake) => (
            <option key={intake.id} value={intake.id}>
              {intakeDate(intake.starts_on)}
              {intake.id === activeIntake?.id ? ' — активная' : ''} ({intake.user_count})
            </option>
          ))}
        </select>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-ui)', maxWidth: 560 }}>
        Единственное место, где выбирается фильтр по потоку — сужает списки Задачи, База
        знаний и Чаты по всей платформе и определяет, в новостной канал какой экспедиции
        уходит репост, если исходное сообщение кросс-поточное. Отдельных переключателей
        на других экранах нет.
      </p>

      {intakes.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>
          Экспедиций пока нет — создайте первую, чтобы заводить участников.
        </p>
      )}

      <div className={styles.list}>
        {intakes.map((intake) => (
          <div className={styles.listItem} key={intake.id}>
            <div className={styles.listItemMain}>
              <span className={styles.listTitle}>
                Экспедиция {intakeDate(intake.starts_on)} – {intakeDate(intake.ends_on)}
                {intake.id === activeIntake?.id ? ' — активная' : ''}
              </span>
              <span className={styles.listMeta}>{intake.user_count} участников</span>
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => setStagesIntake(intake)}>
                Круг Экспедиции
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setEditIntakeWindow(intake)
                  setEditIntakeEndsOn(intake.ends_on)
                }}
              >
                Дата окончания
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit expedition window modal */}
      {editIntakeWindow && (
        <Modal title="Дата закрытия экспедиции" onClose={() => setEditIntakeWindow(null)}>
          <div className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="edit_intake_ends_on">Дата закрытия*</label>
              <input
                id="edit_intake_ends_on"
                className={styles.input}
                type="date"
                value={editIntakeEndsOn}
                onChange={(e) => setEditIntakeEndsOn(e.target.value)}
                min={editIntakeWindow.starts_on}
                autoFocus
              />
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-ui)' }}>
              После этой даты Динамика участников экспедиции становится архивом только для
              чтения: статистика замораживается, отправка ДЗ и помилование дня закрыты.
            </p>
            <div className={styles.formActions}>
              <Button variant="outline" onClick={() => setEditIntakeWindow(null)}>
                Отмена
              </Button>
              <Button
                onClick={handleEditIntakeWindow}
                disabled={updateIntake.isPending || !editIntakeEndsOn}
              >
                {updateIntake.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create expedition modal */}
      {intakeOpen && (
        <Modal title="Новая экспедиция" onClose={() => setIntakeOpen(false)} closeOnBackdrop={false}>
          <div className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="intake_starts_on">Дата старта*</label>
              <input
                id="intake_starts_on"
                className={styles.input}
                type="date"
                value={intakeStartsOn}
                onChange={(e) => setIntakeStartsOn(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="intake_ends_on">Дата закрытия*</label>
              <input
                id="intake_ends_on"
                className={styles.input}
                type="date"
                value={intakeEndsOn}
                onChange={(e) => setIntakeEndsOn(e.target.value)}
                min={intakeStartsOn}
              />
            </div>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-ui)' }}>
              От даты старта считается 28-дневное окно Динамики. Дата закрытия — отдельная
              величина: после неё Динамика становится архивом только для чтения.
            </p>
            <div className={styles.formActions}>
              <Button variant="outline" onClick={() => setIntakeOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={handleCreateIntake}
                disabled={createIntake.isPending || !intakeStartsOn || !intakeEndsOn}
              >
                {createIntake.isPending ? 'Создаём…' : 'Создать экспедицию'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {stagesIntake && (
        <IntakeStagesModal intake={stagesIntake} onClose={() => setStagesIntake(null)} />
      )}

      <hr style={{ margin: 'var(--space-6) 0', border: 'none', borderTop: '1px solid var(--divider)' }} />

      <AdminPlans />
    </div>
  )
}

type StageForm = { air_date: string; air_time: string; task_id: string }

function defaultStages(startsOn: string): Record<StageKind, StageForm> {
  // Дефолт для новой экспедиции — только отправная точка для редактирования,
  // не финальное расписание: даты обязаны строго возрастать (см. валидацию
  // на сохранении), поэтому шесть РАЗНЫХ смещений, а не равные недели.
  const offsets: Record<StageKind, number> = { balance: 0, air: 4, fire: 10, water: 16, earth: 21, final: 27 }
  const out = {} as Record<StageKind, StageForm>
  for (const kind of STAGE_KINDS) {
    const d = new Date(`${startsOn}T00:00:00`)
    d.setDate(d.getDate() + offsets[kind])
    const pad = (n: number) => String(n).padStart(2, '0')
    out[kind] = {
      air_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      air_time: '',
      task_id: '',
    }
  }
  return out
}

/**
 * Расписание шести этапов Круга Экспедиции. PUT целиком (см. StagesUpdate на
 * бэкенде) — фиксированное число строк, частичный PATCH только плодил бы
 * несогласованные графики. Задание на замок — необязательно: без него замок
 * стихии останавливается на «введён», не доходит до «раскрыт» (см. docs/EXPEDITION.md).
 */
function IntakeStagesModal({ intake, onClose }: { intake: IntakeOut; onClose: () => void }) {
  const { data: existing, isLoading } = useIntakeStages(intake.id)
  const { data: taskList } = useTasks()
  const setStages = useSetIntakeStages()

  const [form, setForm] = useState<Record<StageKind, StageForm>>(() => defaultStages(intake.starts_on))

  useEffect(() => {
    if (!existing) return
    if (existing.length === 0) {
      setForm(defaultStages(intake.starts_on))
      return
    }
    const byKind = {} as Record<StageKind, StageForm>
    for (const s of existing) {
      byKind[s.kind] = {
        air_date: s.air_date,
        air_time: s.air_time?.slice(0, 5) ?? '',
        task_id: s.task_id != null ? String(s.task_id) : '',
      }
    }
    setForm(byKind)
  }, [existing, intake.starts_on])

  const patch = (kind: StageKind, field: keyof StageForm, value: string) =>
    setForm((f) => ({ ...f, [kind]: { ...f[kind], [field]: value } }))

  const handleSave = () => {
    const stages: StageIn[] = STAGE_KINDS.map((kind) => ({
      kind,
      air_date: form[kind].air_date,
      air_time: form[kind].air_time ? `${form[kind].air_time}:00` : null,
      task_id: form[kind].task_id ? Number(form[kind].task_id) : null,
    }))
    setStages.mutate(
      { intakeId: intake.id, stages },
      {
        onSuccess: () => {
          toast('Расписание Круга сохранено')
          onClose()
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Не удалось сохранить — проверьте порядок дат', 'error')
        },
      },
    )
  }

  return (
    <Modal
      title={`Круг Экспедиции · ${intakeDate(intake.starts_on)}`}
      onClose={onClose}
      closeOnBackdrop={false}
    >
      {isLoading ? (
        <p>Загрузка…</p>
      ) : (
        <div className={styles.form} style={{ maxWidth: 560 }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-ui)' }}>
            Эфир открывает этап; этап идёт до эфира следующего. Даты должны идти по
            порядку — Точка баланса → Воздух → Огонь → Вода → Земля → Финал.
          </p>
          {STAGE_KINDS.map((kind) => (
            <div key={kind} className={styles.formRow}>
              <label htmlFor={`stage_${kind}_date`}>{STAGE_LABELS[kind]}</label>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <input
                  id={`stage_${kind}_date`}
                  className={styles.input}
                  type="date"
                  value={form[kind]?.air_date ?? ''}
                  onChange={(e) => patch(kind, 'air_date', e.target.value)}
                />
                <input
                  className={styles.input}
                  type="time"
                  value={form[kind]?.air_time ?? ''}
                  onChange={(e) => patch(kind, 'air_time', e.target.value)}
                  aria-label={`Время эфира — ${STAGE_LABELS[kind]}`}
                />
              </div>
              {kind !== 'balance' && kind !== 'final' && (
                <select
                  className={styles.input}
                  value={form[kind]?.task_id ?? ''}
                  onChange={(e) => patch(kind, 'task_id', e.target.value)}
                  aria-label={`Задание, раскрывающее замок «${STAGE_LABELS[kind]}»`}
                >
                  <option value="">Без задания (замок останавливается на «введён»)</option>
                  {taskList?.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <div className={styles.formActions}>
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={setStages.isPending}>
              {setStages.isPending ? 'Сохраняем…' : 'Сохранить расписание'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
