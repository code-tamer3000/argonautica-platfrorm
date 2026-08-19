import { useState } from 'react'
import {
  useAdminIntakes,
  useAdminUsers,
  useCreateIntake,
  useCreateUser,
  useDeleteUser,
  usePatchAdminUser,
  useUpdateIntake,
} from '../../api/admin'
import { useAuth } from '../auth/AuthContext'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { Badge } from '../../components/Badge'
import { PageHeader } from '../../components/PageHeader'
import { toast } from '../../stores/toast'
import type { CreateUserResult } from '../../api/admin'
import type { AdminUserOut, IntakeOut } from '../../lib/types'
import styles from './admin.module.css'

/** `YYYY-MM-DD` → «2 июня 2026». Дата набора — календарная, без часовых поясов. */
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
// срок жизни набора и 28-дневное окно Динамики — разные величины (ARG-96).
function plusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function AdminUsers() {
  const { data: intakes = [] } = useAdminIntakes()
  // Наборы приходят свежими сверху: активный — тот, что стартует последним.
  const activeIntake: IntakeOut | undefined = intakes[0]

  // null — фильтр не трогали: показываем активный набор. 'all' — все наборы.
  const [intakeFilter, setIntakeFilter] = useState<number | 'all' | null>(null)
  const selectedIntake: number | 'all' = intakeFilter ?? activeIntake?.id ?? 'all'

  const { data: users = [] } = useAdminUsers(
    selectedIntake === 'all' ? undefined : selectedIntake,
  )
  const { user: me } = useAuth()
  const createUser = useCreateUser()
  const createIntake = useCreateIntake()
  const updateIntake = useUpdateIntake()
  const patchUser = usePatchAdminUser()
  const deleteUser = useDeleteUser()

  // Create user modal
  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'participant' | 'admin'>('participant')
  const [newUserIntake, setNewUserIntake] = useState<number | null>(null)

  // Create intake modal
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeStartsOn, setIntakeStartsOn] = useState(todayIso())
  const [intakeEndsOn, setIntakeEndsOn] = useState(plusDays(todayIso(), 27))

  // Edit intake window modal (только ends_on — starts_on без API, см. ARG-89)
  const [editIntakeWindow, setEditIntakeWindow] = useState<IntakeOut | null>(null)
  const [editIntakeEndsOn, setEditIntakeEndsOn] = useState('')

  // OTP result modal
  const [otpResult, setOtpResult] = useState<CreateUserResult | null>(null)

  // Edit user modal
  const [editUser, setEditUser] = useState<AdminUserOut | null>(null)
  const [editCanCreate, setEditCanCreate] = useState(false)
  const [editCanCabin, setEditCanCabin] = useState(false)
  const [editObserver, setEditObserver] = useState(false)
  const [editRole, setEditRole] = useState<'participant' | 'admin'>('participant')
  const [editIntake, setEditIntake] = useState<number | null>(null)

  // Группы: показываем либо один выбранный набор, либо все сразу (свежие сверху).
  // Пустой набор тоже виден — только что созданный ещё никого не содержит.
  const visibleIntakes = intakes.filter(
    (intake) => selectedIntake === 'all' || intake.id === selectedIntake,
  )
  const orphans = selectedIntake === 'all' ? users.filter((u) => u.intake_id === null) : []

  function handleCreateOpen() {
    setUsername('')
    setDisplayName('')
    setEmail('')
    setRole('participant')
    // По умолчанию заводим в тот набор, который сейчас на экране.
    setNewUserIntake(
      selectedIntake === 'all' ? (activeIntake?.id ?? null) : selectedIntake,
    )
    setCreateOpen(true)
  }

  function handleCreate() {
    if (!username.trim() || !displayName.trim() || newUserIntake === null) return
    createUser.mutate(
      {
        username: username.trim(),
        display_name: displayName.trim(),
        email: email.trim() || null,
        role,
        intake_id: newUserIntake,
      },
      {
        onSuccess: (result) => {
          setOtpResult(result)
          setCreateOpen(false)
          // Чтобы новый участник не «пропал» — переключаемся на его набор.
          setIntakeFilter(newUserIntake)
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Ошибка', 'error')
        },
      },
    )
  }

  function handleCreateIntake() {
    if (!intakeStartsOn || !intakeEndsOn) return
    createIntake.mutate(
      { starts_on: intakeStartsOn, ends_on: intakeEndsOn },
      {
        onSuccess: (intake) => {
          toast(`Набор от ${intakeDate(intake.starts_on)} создан`)
          setIntakeOpen(false)
          setIntakeFilter(intake.id)
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
          toast('Дата закрытия набора обновлена')
          setEditIntakeWindow(null)
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Ошибка', 'error')
        },
      },
    )
  }

  function handleEditOpen(user: AdminUserOut) {
    setEditUser(user)
    setEditCanCreate(user.can_create_groups)
    setEditCanCabin(user.can_access_cabin)
    setEditObserver(user.is_observer)
    setEditRole(user.role as 'participant' | 'admin')
    setEditIntake(user.intake_id)
  }

  function handleDelete() {
    if (!editUser) return
    if (!window.confirm(`Удалить пользователя ${editUser.display_name} (@${editUser.username})? Действие необратимо.`)) return
    deleteUser.mutate(editUser.id, {
      onSuccess: () => {
        toast('Пользователь удалён')
        setEditUser(null)
      },
      onError: (err: unknown) => {
        toast(err instanceof Error ? err.message : 'Ошибка', 'error')
      },
    })
  }

  function handleEditSave() {
    if (!editUser) return
    patchUser.mutate(
      {
        id: editUser.id,
        can_create_groups: editCanCreate,
        can_access_cabin: editCanCabin,
        // Наблюдатель и админ взаимоисключаемы — у админа флаг всегда снят.
        is_observer: editRole === 'admin' ? false : editObserver,
        role: editRole,
        // Набор отправляем только если он выбран — отвязать участника нельзя.
        ...(editIntake !== null ? { intake_id: editIntake } : {}),
      },
      {
        onSuccess: () => {
          toast('Пользователь обновлён')
          setEditUser(null)
        },
        onError: (err: unknown) => {
          toast(err instanceof Error ? err.message : 'Ошибка', 'error')
        },
      },
    )
  }

  function renderUser(user: AdminUserOut) {
    return (
      <div key={user.id} className={styles.listItem}>
        <div className={styles.listItemMain}>
          <div>
            <div className={styles.listTitle}>{user.display_name}</div>
            <div className={styles.listMeta}>@{user.username}</div>
          </div>
          <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>
            {user.is_observer ? 'наблюдатель' : user.role}
          </Badge>
        </div>
        <div className={styles.listActions}>
          <Button variant="outline" onClick={() => handleEditOpen(user)}>
            Редактировать
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="Пользователи">
        <div className={styles.listActions}>
          <Button
            variant="outline"
            onClick={() => {
              const start = todayIso()
              setIntakeStartsOn(start)
              setIntakeEndsOn(plusDays(start, 27))
              setIntakeOpen(true)
            }}
          >
            Новый набор
          </Button>
          <Button onClick={handleCreateOpen} disabled={intakes.length === 0}>
            Создать пользователя
          </Button>
        </div>
      </PageHeader>

      <div className={styles.formRow} style={{ maxWidth: 420 }}>
        <label htmlFor="intake_filter">Набор</label>
        <select
          id="intake_filter"
          className={styles.input}
          value={String(selectedIntake)}
          onChange={(e) =>
            setIntakeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
          }
        >
          {intakes.map((intake) => (
            <option key={intake.id} value={intake.id}>
              {intakeDate(intake.starts_on)}
              {intake.id === activeIntake?.id ? ' — активный' : ''} ({intake.user_count})
            </option>
          ))}
          <option value="all">Все наборы</option>
        </select>
      </div>

      {intakes.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>
          Наборов пока нет — создайте первый, чтобы заводить участников.
        </p>
      )}

      {visibleIntakes.map((intake) => {
        const groupUsers = users.filter((u) => u.intake_id === intake.id)
        return (
          <section key={intake.id}>
            <div className={styles.pageHeader} style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>
              <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                Набор {intakeDate(intake.starts_on)} – {intakeDate(intake.ends_on)}
                {intake.id === activeIntake?.id ? ' — активный' : ''}
              </h2>
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
            <div className={styles.list}>
              {groupUsers.map(renderUser)}
              {groupUsers.length === 0 && (
                <p style={{ color: 'var(--text-secondary)' }}>В этом наборе пока никого нет.</p>
              )}
            </div>
          </section>
        )
      })}

      {orphans.length > 0 && (
        <section>
          <h2 className={styles.sectionTitle}>Без набора</h2>
          <div className={styles.list}>{orphans.map(renderUser)}</div>
        </section>
      )}

      {/* Edit intake window modal */}
      {editIntakeWindow && (
        <Modal title="Дата закрытия набора" onClose={() => setEditIntakeWindow(null)}>
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
              После этой даты Динамика участников набора становится архивом только для
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

      {/* Create intake modal */}
      {intakeOpen && (
        <Modal title="Новый набор" onClose={() => setIntakeOpen(false)} closeOnBackdrop={false}>
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
                {createIntake.isPending ? 'Создаём…' : 'Создать набор'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Create user modal */}
      {createOpen && (
        <Modal title="Новый пользователь" onClose={() => setCreateOpen(false)} closeOnBackdrop={false}>
          <div className={styles.form}>
            <div className={styles.formRow}>
              <label>Имя пользователя (username)*</label>
              <input
                className={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ivanov"
                autoFocus
              />
            </div>
            <div className={styles.formRow}>
              <label>Отображаемое имя*</label>
              <input
                className={styles.input}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Иван Иванов"
              />
            </div>
            <div className={styles.formRow}>
              <label>Email (необязательно)</label>
              <input
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ivan@example.com"
              />
            </div>
            <div className={styles.formRow}>
              <label htmlFor="new_user_intake">Набор*</label>
              <select
                id="new_user_intake"
                className={styles.input}
                value={newUserIntake ?? ''}
                onChange={(e) => setNewUserIntake(Number(e.target.value))}
              >
                {intakes.map((intake) => (
                  <option key={intake.id} value={intake.id}>
                    {intakeDate(intake.starts_on)}
                    {intake.id === activeIntake?.id ? ' — активный' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <label>Роль</label>
              <select
                className={styles.input}
                value={role}
                onChange={(e) => setRole(e.target.value as 'participant' | 'admin')}
              >
                <option value="participant">participant</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className={styles.formActions}>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  createUser.isPending ||
                  !username.trim() ||
                  !displayName.trim() ||
                  newUserIntake === null
                }
              >
                {createUser.isPending ? 'Создаём…' : 'Создать'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* OTP result modal */}
      {otpResult && (
        <Modal title="Пользователь создан" onClose={() => setOtpResult(null)} closeOnBackdrop={false}>
          <div className={styles.form}>
            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
              Пользователь <strong>{otpResult.username}</strong> создан. Одноразовый пароль:
            </p>
            <div className={styles.oneTimePass}>{otpResult.one_time_password}</div>
            <div className={styles.copyRow}>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(otpResult.one_time_password)
                  toast('Скопировано')
                }}
              >
                Копировать
              </Button>
              <Button onClick={() => setOtpResult(null)}>Закрыть</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit user modal */}
      {editUser && (
        <Modal title={`Редактировать: ${editUser.display_name}`} onClose={() => setEditUser(null)} closeOnBackdrop={false}>
          <div className={styles.form}>
            <div className={styles.formRow}>
              <label htmlFor="edit_user_intake">Набор</label>
              <select
                id="edit_user_intake"
                className={styles.input}
                value={editIntake ?? ''}
                onChange={(e) =>
                  setEditIntake(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                {editIntake === null && <option value="">Без набора</option>}
                {intakes.map((intake) => (
                  <option key={intake.id} value={intake.id}>
                    {intakeDate(intake.starts_on)}
                    {intake.id === activeIntake?.id ? ' — активный' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formRow}>
              <label>Роль</label>
              <select
                className={styles.input}
                value={editRole}
                onChange={(e) => setEditRole(e.target.value as 'participant' | 'admin')}
              >
                <option value="participant">participant</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div className={styles.checkRow}>
              <input
                type="checkbox"
                id="can_create_groups"
                checked={editCanCreate}
                onChange={(e) => setEditCanCreate(e.target.checked)}
              />
              <label htmlFor="can_create_groups" style={{ color: 'var(--text-primary)', fontSize: 'var(--text-ui)' }}>
                Может создавать группы
              </label>
            </div>
            <div className={styles.checkRow}>
              <input
                type="checkbox"
                id="can_access_cabin"
                checked={editCanCabin}
                onChange={(e) => setEditCanCabin(e.target.checked)}
              />
              <label htmlFor="can_access_cabin" style={{ color: 'var(--text-primary)', fontSize: 'var(--text-ui)' }}>
                Доступ к разделу «Каюта»
              </label>
            </div>
            <div className={styles.checkRow}>
              <input
                type="checkbox"
                id="is_observer"
                checked={editRole === 'admin' ? false : editObserver}
                disabled={editRole === 'admin'}
                onChange={(e) => setEditObserver(e.target.checked)}
              />
              <label htmlFor="is_observer" style={{ color: 'var(--text-primary)', fontSize: 'var(--text-ui)' }}>
                Режим наблюдателя (только материалы: База знаний, Генные замки)
              </label>
            </div>
            {editRole !== 'admin' && editObserver && (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-ui)' }}>
                Закрывает Рубку, Новости, Задачи, Календарь, Каюту, Динамику и уведомления.
              </p>
            )}
            <div className={styles.formActions}>
              {editUser.id !== me?.id && (
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  disabled={deleteUser.isPending}
                  style={{ marginRight: 'auto' }}
                >
                  {deleteUser.isPending ? 'Удаляем…' : 'Удалить'}
                </Button>
              )}
              <Button variant="outline" onClick={() => setEditUser(null)}>
                Отмена
              </Button>
              <Button onClick={handleEditSave} disabled={patchUser.isPending}>
                {patchUser.isPending ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
