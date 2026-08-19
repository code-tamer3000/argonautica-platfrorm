import { useState } from 'react'
import { useAdminIntakes, useCreateIntake, useUpdateIntake } from '../../api/admin'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { PageHeader } from '../../components/PageHeader'
import { toast } from '../../stores/toast'
import { useUiStore } from '../../stores/ui'
import type { IntakeOut } from '../../lib/types'
import { AdminPlans } from './AdminPlans'
import styles from './admin.module.css'

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

      <hr style={{ margin: 'var(--space-6) 0', border: 'none', borderTop: '1px solid var(--divider)' }} />

      <AdminPlans />
    </div>
  )
}
