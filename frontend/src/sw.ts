/// <reference lib="webworker" />
// Кастомный service worker (injectManifest). Делает две вещи:
//  1) прекэш оболочки + управляемое обновление (сохраняем UX баннера «обновить»);
//  2) нативные push-уведомления: показ по событию `push` и навигация по клику.
// API/WS никогда не кэшируем — precacheAndRoute трогает только собранные ассеты,
// а навигационный fallback исключает /api и /ws.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

// __WB_MANIFEST — сюда Workbox инжектит список прекэш-ассетов на сборке.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// registerType:'prompt' + useRegisterSW: клиент шлёт SKIP_WAITING, когда юзер
// нажал «Обновить» в баннере. Без этого новый SW висел бы в waiting.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})

interface PushPayload {
  title: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    // Нераспарсиваемый payload — показываем как есть текстом, чтоб не потерять.
    payload = { title: 'Аргонавтика', body: event.data.text() }
  }
  const url = payload.url ?? '/'
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body ?? '',
      // tag: новый пуш того же разговора заменяет старый в шторке, а не копит стопку.
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Уже открытая вкладка приложения — фокусируем и ведём на нужный маршрут.
        for (const client of clients) {
          if ('focus' in client) {
            void client.focus()
            if ('navigate' in client) void client.navigate(targetUrl)
            return
          }
        }
        // Иначе открываем новое окно.
        return self.clients.openWindow(targetUrl).then(() => undefined)
      }),
  )
})
