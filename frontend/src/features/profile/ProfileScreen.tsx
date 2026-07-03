import { useEffect, useRef, useState } from 'react'
import { useMyDynamics, usePardon } from '../../api/dynamics'
import { usePatchMe } from '../../api/profile'
import { Avatar } from '../../components/Avatar'
import { Button } from '../../components/Button'
import { Spinner } from '../../components/Spinner'
import { mediaUpload } from '../../lib/mediaUpload'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import styles from './profile.module.css'

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function DynamicsSection() {
  const { data: dyn, isLoading } = useMyDynamics()
  const pardon = usePardon()

  if (isLoading) return <div className={styles.section}><Spinner size={20} /></div>
  if (!dyn) return null

  const allGood = dyn.overdue_dates.length === 0

  function handlePardon(date: string) {
    pardon.mutate(date, {
      onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
    })
  }

  return (
    <div className={styles.section}>
      <span className={styles.fieldLabel}>Домашние задания</span>

      {dyn.streak > 0 && (
        <div className={styles.dynStreak}>🔥 Стрик: {dyn.streak} {dyn.streak === 1 ? 'день' : dyn.streak < 5 ? 'дня' : 'дней'}</div>
      )}

      {allGood ? (
        <div className={styles.dynOk}>✓ Все задания выполнены в срок</div>
      ) : (
        <div className={styles.dynOverdueList}>
          {dyn.overdue_dates.map((d) => (
            <div key={d} className={styles.dynOverdueItem}>
              <span className={styles.dynOverdueLabel}>✗ Не выполнено ДЗ за {formatDate(d)}</span>
              {dyn.pardons_remaining > 0 && (
                <button
                  className={styles.dynPardonBtn}
                  onClick={() => handlePardon(d)}
                  disabled={pardon.isPending}
                  title={`Осталось помилований: ${dyn.pardons_remaining}`}
                >
                  🐋 Плавы с китами
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {dyn.pardons_used > 0 && (
        <div className={styles.dynPardonInfo}>
          Использовано помилований: {dyn.pardons_used} / 3
          {dyn.pardons_remaining === 0 && ' — лимит исчерпан'}
        </div>
      )}
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

  // Sync when user changes (e.g. after refresh)
  useEffect(() => {
    setDisplayName(user?.display_name ?? '')
    setBio(user?.bio ?? '')
  }, [user?.display_name, user?.bio])

  if (!user) return <div className="center grow"><Spinner /></div>

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
          onSuccess: async () => {
            await refreshMe()
            toast('Аватар обновлён')
          },
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
        onSuccess: async () => {
          await refreshMe()
          toast('Аватар удалён')
        },
        onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  function handleSave() {
    const name = displayName.trim()
    if (!name) {
      toast('Имя не может быть пустым', 'error')
      return
    }
    patchMe.mutate(
      { display_name: name, bio: bio.trim() || null },
      {
        onSuccess: async () => {
          await refreshMe()
          toast('Профиль сохранён')
        },
        onError: (err) => toast(err instanceof Error ? err.message : 'Ошибка', 'error'),
      },
    )
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Профиль</h1>

      {/* Avatar section */}
      <div className={styles.section}>
        <div className={styles.avatarRow}>
          {avatarUploading ? (
            <div className={styles.avatarBig + ' center'}><Spinner size={24} /></div>
          ) : (
            <Avatar name={user.display_name} url={user.avatar_url} size={80} />
          )}
          <div className={styles.avatarActions}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={handleAvatarChange}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={avatarUploading || patchMe.isPending}>
              Изменить фото
            </Button>
            {user.avatar_url && (
              <Button variant="outline" onClick={handleRemoveAvatar} disabled={patchMe.isPending}>
                Удалить фото
              </Button>
            )}
          </div>
        </div>
        <div className={styles.usernameRow}>
          <span className={styles.fieldLabel}>Логин</span>
          <span className={styles.usernameValue}>{user.username}</span>
        </div>
      </div>

      {/* Edit fields */}
      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="displayName">Отображаемое имя</label>
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
            rows={4}
            maxLength={300}
            placeholder="Расскажите о себе…"
          />
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="gold" onClick={handleSave} disabled={patchMe.isPending}>
          {patchMe.isPending ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>

      {user.role !== 'admin' && <DynamicsSection />}
    </div>
  )
}
