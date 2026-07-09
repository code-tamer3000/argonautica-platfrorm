import { useEffect, useState } from 'react'
import { usePatchMe } from '../../api/profile'
import {
  hasActiveSubscription,
  isStandalone,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../lib/push'
import { toast } from '../../stores/toast'
import { useAuth } from '../auth/AuthContext'
import styles from './profile.module.css'

// Пер-видовые тумблеры (что именно пушить). journal_missed/cabin_granted отдельного
// тумблера не имеют — управляются мастер-флагом. См. backend notify_prefs.py.
const KIND_TOGGLES: { key: 'dm' | 'reply' | 'news' | 'admin'; label: string }[] = [
  { key: 'dm', label: 'Личные сообщения' },
  { key: 'reply', label: 'Ответы на мои сообщения' },
  { key: 'news', label: 'Новости в канале' },
  { key: 'admin', label: 'Объявления от администрации' },
]

interface NotifPrefs {
  push_enabled: boolean
  dm: boolean
  reply: boolean
  news: boolean
  admin: boolean
}

function readPrefs(settings: Record<string, unknown>): NotifPrefs {
  const raw = (settings.notifications ?? {}) as Record<string, unknown>
  const bool = (k: string) => raw[k] !== false // по умолчанию всё включено
  return {
    push_enabled: raw.push_enabled === true,
    dm: bool('dm'),
    reply: bool('reply'),
    news: bool('news'),
    admin: bool('admin'),
  }
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className={styles.switch}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className={styles.switchTrack}>
        <span className={styles.switchThumb} />
      </span>
    </label>
  )
}

export function NotificationsSection() {
  const { user, refreshMe } = useAuth()
  const patchMe = usePatchMe()
  const [busy, setBusy] = useState(false)
  const support = pushSupport()
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    void hasActiveSubscription().then(setSubscribed)
  }, [])

  if (!user) return null
  const prefs = readPrefs(user.settings)

  // Сохранить настройки уведомлений в user.settings (мержим, не затираем чужие ключи).
  async function savePrefs(next: Partial<NotifPrefs>) {
    const merged = {
      ...(user!.settings.notifications as Record<string, unknown> | undefined),
      ...next,
    }
    await patchMe.mutateAsync({ settings: { ...user!.settings, notifications: merged } })
    await refreshMe()
  }

  async function handleMasterToggle(on: boolean) {
    setBusy(true)
    try {
      if (on) {
        await subscribeToPush() // спросит разрешение + оформит подписку
        await savePrefs({ push_enabled: true })
        setSubscribed(true)
        toast('Push-уведомления включены')
      } else {
        await unsubscribeFromPush()
        await savePrefs({ push_enabled: false })
        setSubscribed(false)
        toast('Push-уведомления отключены')
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось изменить настройку', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleKindToggle(key: 'dm' | 'reply' | 'news' | 'admin', v: boolean) {
    try {
      await savePrefs({ [key]: v })
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка', 'error')
    }
  }

  const denied = support.permission === 'denied'
  const iosNeedsInstall =
    support.supported && !isStandalone() && /iP(hone|ad|od)/.test(navigator.userAgent)
  const masterOn = prefs.push_enabled && subscribed

  return (
    <div className={styles.settingCard}>
      <h2 className={styles.settingTitle}>Уведомления</h2>

      {!support.supported ? (
        <div className={styles.notifNote}>
          Этот браузер не поддерживает нативные уведомления.
        </div>
      ) : (
        <>
          <div className={styles.notifRow}>
            <div className={styles.notifRowText}>
              <span className={styles.notifRowLabel}>Push-уведомления</span>
              <span className={styles.notifRowHint}>
                Приходят на телефон и компьютер, даже когда вкладка закрыта
              </span>
            </div>
            <Switch
              checked={masterOn}
              disabled={busy || denied}
              onChange={handleMasterToggle}
              label="Push-уведомления"
            />
          </div>

          {denied && (
            <div className={styles.notifNote}>
              Уведомления заблокированы в настройках браузера — разрешите их для этого
              сайта, чтобы включить push.
            </div>
          )}
          {iosNeedsInstall && !denied && (
            <div className={styles.notifNote}>
              На iPhone/iPad push работают только после добавления приложения на экран
              «Домой» (кнопка «Поделиться» → «На экран Домой»).
            </div>
          )}

          {masterOn && (
            <div className={styles.notifSubGroup}>
              {KIND_TOGGLES.map(({ key, label }) => (
                <div key={key} className={styles.notifRow}>
                  <span className={styles.notifRowLabel}>{label}</span>
                  <Switch
                    checked={prefs[key]}
                    disabled={patchMe.isPending}
                    onChange={(v) => handleKindToggle(key, v)}
                    label={label}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
