// Клиентская часть Web Push: разрешение, подписка через service worker, отправка
// её на бэкенд. Мастер-тумблер в профиле дёргает subscribe/unsubscribe; пер-видовые
// тумблеры (ЛС/ответы/новости/админ) — это уже настройки на сервере (settings), сюда
// не относятся. Всё best-effort: любая неудача → бросаем ошибку с понятным текстом,
// профиль показывает её тостом и откатывает тумблер.
import { http } from './apiClient'

export interface PushSupport {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
}

// Поддержка Web Push: нужны SW, PushManager и Notification. На iOS работает только
// в установленной PWA (standalone) — вне её pushManager есть, но подписка упадёт.
export function pushSupport(): PushSupport {
  const supported =
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  return {
    supported,
    permission: supported ? Notification.permission : 'unsupported',
  }
}

// iOS разрешает push только когда приложение добавлено на «Домой» (standalone).
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari — нестандартный флаг.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

// VAPID public key приходит url-safe-base64; pushManager.subscribe хочет байты
// в ArrayBuffer (BufferSource). Явно выделяем ArrayBuffer, чтобы тип совпал.
function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const buffer = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.ready
  return reg
}

// Запросить разрешение и оформить подписку, отправив её на сервер. Возвращает true,
// если подписка активна. Бросает Error с текстом для показа пользователю.
export async function subscribeToPush(): Promise<void> {
  const { supported } = pushSupport()
  if (!supported) throw new Error('Браузер не поддерживает push-уведомления')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Уведомления запрещены в настройках браузера'
        : 'Разрешение на уведомления не выдано',
    )
  }

  const { public_key } = await http.get<{ public_key: string }>('/api/push/vapid-key')
  const reg = await getRegistration()
  const existing = await reg.pushManager.getSubscription()
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(public_key),
    }))

  const json = sub.toJSON()
  await http.post('/api/push/subscribe', {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    user_agent: navigator.userAgent,
  })
}

// Снять подписку локально и на сервере. Не бросает — best-effort очистка.
export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg = await getRegistration()
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    await http.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  } catch {
    // Нет SW / нет подписки — считаем, что уже отписаны.
  }
}

// Активна ли push-подписка в этом браузере прямо сейчас.
export async function hasActiveSubscription(): Promise<boolean> {
  const { supported } = pushSupport()
  if (!supported || Notification.permission !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker.ready
    return (await reg.pushManager.getSubscription()) != null
  } catch {
    return false
  }
}
