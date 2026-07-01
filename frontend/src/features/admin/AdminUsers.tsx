import { useState } from 'react'
import { useAdminUsers, useCreateUser, usePatchAdminUser } from '../../api/admin'
import { Modal } from '../../components/Overlay'
import { Button } from '../../components/Button'
import { toast } from '../../stores/toast'
import type { CreateUserResult } from '../../api/admin'
import type { AdminUserOut } from '../../lib/types'
import styles from './admin.module.css'

export function AdminUsers() {
  const { data: users = [] } = useAdminUsers()
  const createUser = useCreateUser()
  const patchUser = usePatchAdminUser()

  // Create user modal
  const [createOpen, setCreateOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'participant' | 'admin'>('participant')

  // OTP result modal
  const [otpResult, setOtpResult] = useState<CreateUserResult | null>(null)

  // Edit user modal
  const [editUser, setEditUser] = useState<AdminUserOut | null>(null)
  const [editCanCreate, setEditCanCreate] = useState(false)
  const [editRole, setEditRole] = useState<'participant' | 'admin'>('participant')

  function handleCreateOpen() {
    setUsername('')
    setDisplayName('')
    setEmail('')
    setRole('participant')
    setCreateOpen(true)
  }

  function handleCreate() {
    if (!username.trim() || !displayName.trim()) return
    createUser.mutate(
      {
        username: username.trim(),
        display_name: displayName.trim(),
        email: email.trim() || null,
        role,
      },
      {
        onSuccess: (result) => {
          setOtpResult(result)
          setCreateOpen(false)
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
    setEditRole(user.role as 'participant' | 'admin')
  }

  function handleEditSave() {
    if (!editUser) return
    patchUser.mutate(
      { id: editUser.id, can_create_groups: editCanCreate, role: editRole },
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

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Пользователи</h1>
        <Button onClick={handleCreateOpen}>Создать пользователя</Button>
      </div>

      <div className={styles.list}>
        {users.map((user) => (
          <div key={user.id} className={styles.listItem}>
            <div className={styles.listItemMain}>
              <div>
                <div className={styles.listTitle}>{user.display_name}</div>
                <div className={styles.listMeta}>@{user.username}</div>
              </div>
              <span className={user.role === 'admin' ? styles.badgePublished : styles.badgeDraft}>
                {user.role}
              </span>
            </div>
            <div className={styles.listActions}>
              <Button variant="outline" onClick={() => handleEditOpen(user)}>
                Редактировать
              </Button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p style={{ color: 'var(--text-secondary)' }}>Пользователей пока нет.</p>
        )}
      </div>

      {/* Create user modal */}
      {createOpen && (
        <Modal title="Новый пользователь" onClose={() => setCreateOpen(false)}>
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
                disabled={createUser.isPending || !username.trim() || !displayName.trim()}
              >
                {createUser.isPending ? 'Создаём…' : 'Создать'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* OTP result modal */}
      {otpResult && (
        <Modal title="Пользователь создан" onClose={() => setOtpResult(null)}>
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
        <Modal title={`Редактировать: ${editUser.display_name}`} onClose={() => setEditUser(null)}>
          <div className={styles.form}>
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
            <div className={styles.formActions}>
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
