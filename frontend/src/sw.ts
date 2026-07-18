/// <reference lib="webworker" />
// Кастомный service worker (injectManifest). Делает три вещи:
//  1) прекэш оболочки + управляемое обновление (сохраняем UX баннера «обновить»);
//  2) рантайм-кэш картинок медиа с ключом без presigned-подписи (см. ниже);
//  3) нативные push-уведомления: показ по событию `push` и навигация по клику.
// API/WS никогда не кэшируем — precacheAndRoute трогает только собранные ассеты,
// а навигационный fallback исключает /api и /ws.
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { MEDIA_CACHE_NAME, isMediaPath, mediaCacheKey } from './lib/mediaCache'

declare const self: ServiceWorkerGlobalScope

// __WB_MANIFEST — сюда Workbox инжектит список прекэш-ассетов на сборке.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// --- Рантайм-кэш картинок медиа -------------------------------------------
//
// Медиа лежит на том же origin (/chat-media/, /kb-media/), ответы не opaque —
// кэшируются нормально. Проблема была только в ключе: presigned-URL меняется на
// каждой отдаче ленты, поэтому кэшируем по origin+pathname (см. lib/mediaCache).
//
// Осознанно кэшируем ТОЛЬКО картинки:
//  • видео крупное и убивает квоту на телефоне, а главное — играется range-запросами;
//    CacheFirst поверх range сломал бы перемотку (известные грабли проекта);
//  • поэтому дополнительно пропускаем мимо кэша ЛЮБОЙ запрос с заголовком Range.
// Расширения — потому что лайтбокс тянет картинку через fetch (destination '' ,
// не 'image'), и без проверки пути под правило попало бы и видео.
const IMAGE_EXT_RE = /\.(webp|jpe?g|png|gif|avif|bmp|heic|heif)$/i

registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin &&
    isMediaPath(url.pathname) &&
    // Range → мимо кэша: это стриминг (видео/аудио), CacheFirst его сломает.
    !request.headers.has('range') &&
    request.destination !== 'video' &&
    request.destination !== 'audio' &&
    (request.destination === 'image' || IMAGE_EXT_RE.test(url.pathname)),
  new CacheFirst({
    cacheName: MEDIA_CACHE_NAME,
    plugins: [
      {
        // Ключевое место всей фичи: ключ без query, иначе кэш снова не попадает.
        cacheKeyWillBeUsed: async ({ request }) => mediaCacheKey(request.url),
      },
      // Ограничиваем рост: телефон не должен копить гигабайты картинок.
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 7 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

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
