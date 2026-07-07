import { useEffect, useRef, useState } from 'react'
import { useMyDynamics, usePardon } from '../../api/dynamics'
import { usePatchMe } from '../../api/profile'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { IconAlert, IconCheck, IconFlame, IconMoon, IconSun, IconWaves } from '../../components/icons'
import { Spinner } from '../../components/Spinner'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import { useThemeStore, type Theme } from '../../stores/theme'
import { useAuth } from '../auth/AuthContext'
import styles from './profile.module.css'

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function streakLabel(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'дня'
  return 'дней'
}

function DynamicsSection() {
  const { data: dyn, isLoading } = useMyDynamics()
  const pardon = usePardon()

  if (isLoading) return (
    <div className={styles.dynCard}>
      <div className="center" style={{ padding: 'var(--space-6)' }}><Spinner size={20} /></div>
    </div>
  )
  if (!dyn) return null

  const allGood = dyn.overdue_dates.length === 0

  function handlePardon(date: string) {
    pardon.mutate(date, {
      onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.dynCard}>
      <h2 className={styles.dynTitle}>Домашние задания</h2>

      {/* Стрик */}
      {dyn.streak > 0 && (
        <div className={styles.dynStreak}>
          <IconFlame size={20} className={styles.dynStreakIcon} />
          <span className={styles.dynStreakNum}>{dyn.streak}</span>
          <span className={styles.dynStreakLabel}>{streakLabel(dyn.streak)} подряд</span>
        </div>
      )}

      {/* Статус */}
      {allGood ? (
        <div className={styles.dynStatus + ' ' + styles.dynStatusOk}>
          <IconCheck size={18} />
          <span>Все задания выполнены в срок</span>
        </div>
      ) : (
        <div className={styles.dynOverdueWrap}>
          <div className={styles.dynStatus + ' ' + styles.dynStatusBad}>
            <IconAlert size={18} />
            <span>{dyn.overdue_dates.length === 1 ? 'Есть невыполненное задание' : `Пропущено заданий: ${dyn.overdue_dates.length}`}</span>
          </div>

          <div className={styles.dynOverdueList}>
            {dyn.overdue_dates.map((d) => (
              <div key={d} className={styles.dynOverdueItem}>
                <span className={styles.dynOverdueDate}>За {formatDate(d)}</span>
                {dyn.pardons_remaining > 0 ? (
                  <button
                    className={styles.dynPardonBtn}
                    onClick={() => handlePardon(d)}
                    disabled={pardon.isPending}
                  >
                    <IconWaves size={15} />
                    Плавал с китами
                  </button>
                ) : (
                  <span className={styles.dynNoPardons}>помилований не осталось</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Помилования */}
      <div className={styles.dynPardons}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={styles.dynPardonDot + ' ' + (i < dyn.pardons_used ? styles.dynPardonDotUsed : styles.dynPardonDotFree)}
            title={i < dyn.pardons_used ? 'Использовано' : 'Доступно'}
          >
            <IconWaves size={12} />
          </div>
        ))}
        <span className={styles.dynPardonsLabel}>
          {dyn.pardons_remaining > 0
            ? `Осталось помилований: ${dyn.pardons_remaining}`
            : 'Все помилования использованы'}
        </span>
      </div>
    </div>
  )
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof IconSun }[] = [
  { value: 'dark', label: 'Тёмная', icon: IconMoon },
  { value: 'light', label: 'Светлая', icon: IconSun },
]

function ThemeSection() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className={styles.settingCard}>
      <h2 className={styles.settingTitle}>Оформление</h2>
      <div className={styles.themeToggle} role="group" aria-label="Тема оформления">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            className={styles.themeOption + (theme === value ? ' ' + styles.themeOptionActive : '')}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function ProfileScreen() {
  const { user, refreshMe } = useAuth()
  const patchMe = usePatchMe()
  const fileRef = useRef<HTMLInputElement>(null)

  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [avatarUploading, setAvatarUploading] = useState(false)

  useEffect(() => {
    setDisplayName(user?.display_name ?? '')
    setBio(user?.bio ?? '')
  }, [user?.display_name, user?.bio])

  if (!user) return <div className="center grow"><Spinner /></div>

  const isDirty =
    displayName.trim() !== (user.display_name ?? '') ||
    bio.trim() !== (user.bio ?? '')

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setAvatarUploading(true)
    try {
      const asset = await mediaUpload(file)
      patchMe.mutate(
        { avatar_media_id: asset.id },
        {
          onSuccess: async () => { await refreshMe(); toast('Аватар обновлён') },
          onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
        },
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки', 'error')
    } finally {
      setAvatarUploading(false)
    }
  }

  function handleRemoveAvatar() {
    patchMe.mutate(
      { avatar_media_id: null },
      {
        onSuccess: async () => { await refreshMe(); toast('Аватар удалён') },
        onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleSave() {
    const name = displayName.trim()
    if (!name) { toast('Имя не может быть пустым', 'error'); return }
    patchMe.mutate(
      { display_name: name, bio: bio.trim() || null },
      {
        onSuccess: async () => { await refreshMe(); toast('Профиль сохранён') },
        onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  return (
    <div className={styles.page}>
      {/* Шапка профиля */}
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          {avatarUploading
            ? <div className={styles.avatarPlaceholder}><Spinner size={24} /></div>
            : <Avatar name={user.display_name} url={user.avatar_url} size={72} />
          }
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
          <button
            className={styles.avatarEditBtn}
            onClick={() => fileRef.current?.click()}
            disabled={avatarUploading || patchMe.isPending}
            title="Изменить фото"
          >
            Сменить
          </button>
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.headerName}>{user.display_name}</div>
          <div className={styles.headerUsername}>@{user.username}</div>
          {user.avatar_url && (
            <button className={styles.removeAvatarBtn} onClick={handleRemoveAvatar} disabled={patchMe.isPending}>
              Удалить фото
            </button>
          )}
        </div>
      </div>

      {/* Форма редактирования */}
      <div className={styles.formCard}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="displayName">Имя</label>
          <input
            id="displayName"
            className={styles.fieldInput}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="bio">О себе</label>
          <textarea
            id="bio"
            className={styles.fieldTextarea}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Расскажите о себе…"
          />
        </div>
        {isDirty && (
          <div className={styles.formActions}>
            <Button variant="outline" onClick={() => { setDisplayName(user.display_name); setBio(user.bio ?? '') }}>
              Отмена
            </Button>
            <Button variant="gold" onClick={handleSave} disabled={patchMe.isPending}>
              {patchMe.isPending ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        )}
      </div>

      {/* Оформление — доступно всем */}
      <ThemeSection />

      {/* Динамика — только для участников */}
      {user.role !== 'admin' && <DynamicsSection />}
    </div>
  )
}
