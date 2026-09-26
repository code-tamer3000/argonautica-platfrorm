// Persist кэша TanStack Query в IndexedDB — «бутстрап»: при следующем заходе
// комнаты/сообщения/профили рисуются мгновенно из кэша, а сеть догоняет фоном.
// Без сторонних пакетов: сериализуем нужные запросы сами.
//
// Кэшируем ТОЛЬКО стабильные, неприватные срезы: список комнат, пользователей,
// стикеры, ленты сообщений. Не персистим presigned-URL с коротким TTL как
// единственный источник — они в attachments лишь для быстрого показа, реальный
// путь всё равно перезапросит. Токены/секреты в кэш Query не попадают.
import type { QueryClient } from '@tanstack/react-query'
import { idbGet, idbSet, STORE_QUERYCACHE } from './idb'

const CACHE_KEY = 'v1'
// Не поднимаем протухший кэш: если снимку больше суток — игнорируем.
const MAX_AGE_MS = 24 * 60 * 60 * 1000

// Какие запросы персистим — по первому сегменту queryKey. 'dashboard' (ARG-146) —
// иначе холодный офлайн-старт разлочил только Рубку, а домашняя «Круг Экспедиции»
// всё равно висела на спиннере: /api/dashboard — один запрос текущего юзера
// (экспедиция/дневник/задачи/уведомления/новость-превью), тот же уровень
// приватности, что у уже персистимых rooms/messages.
// 'kb'/'tasks'/'dynamics'/'notifications' (ARG-147) — те же холодные офлайн-грабли
// для КБ/Задач/Динамики/Уведомлений: данные лежат в кэше Query до перезапуска
// процесса, но без персиста экран всё равно показывал пустое/загрузочное
// состояние. Новости отдельного ключа не требуют — открытая новость это обычная
// комната/сообщения (is_news), уже покрыта 'rooms'/'messages'. Каюта — исключение,
// см. «Границы» ARG-147: единственный раздел с настоящей приватностью, гейт
// устройства не шифрует IndexedDB, персист туда не добавляем.
// 'media' — presigned-URL для вложений, резолвимых по assetId (`useMediaUrl`,
// `api/media.ts`), а не приходящих инлайном в сообщении: путь КБ (Attachment
// без `attachment`, только `assetId`). Без этого ключа сам JSON с URL не
// переживал офлайн, и вложение висело на «загрузка…» даже когда материал КБ
// был открыт заранее — тот же класс бага, что чинил ARG-147, просто для ещё
// одного query-префикса. 'argonauts' — ростер и профиль-страница участника
// (`api/argonauts.ts`) вообще не персистились: список найден по факту при
// разборе бага с картинками, не про сами картинки.
const PERSIST_KEYS = new Set([
  'rooms',
  'users',
  'stickers',
  'stickerpacks',
  'messages',
  'dashboard',
  'kb',
  'tasks',
  'dynamics',
  'notifications',
  'media',
  'argonauts',
])

interface Snapshot {
  savedAt: number
  queries: Array<{ key: unknown; state: unknown }>
}

function shouldPersist(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return typeof head === 'string' && PERSIST_KEYS.has(head)
}

// Восстановить кэш из IndexedDB ДО первого рендера (в main.tsx перед render).
export async function restoreQueryCache(qc: QueryClient): Promise<void> {
  const snap = await idbGet<Snapshot>(STORE_QUERYCACHE, CACHE_KEY)
  if (!snap || Date.now() - snap.savedAt > MAX_AGE_MS) return
  for (const { key, state } of snap.queries) {
    if (!Array.isArray(key)) continue
    // Данные считаем сразу устаревшими (dataUpdatedAt=0) — они рисуются мгновенно,
    // но помечены stale, поэтому первый фокус/маунт триггерит фоновый рефетч.
    const s = state as { data?: unknown }
    if (s?.data === undefined) continue
    qc.setQueryData(key, s.data, { updatedAt: 0 })
  }
}

// Подписка на изменения кэша с дебаунсом — пишем снимок в IndexedDB.
//
// Снимок МЁРЖИТСЯ поверх предыдущего, а не переписывается целиком (ARG-151,
// «второй холодный офлайн-заход теряет то, что показал первый» — репортнуто
// руками). Раньше фильтр требовал status==='success': стоило фоновому
// рефетчу (маунт/фокус на restored-с-updatedAt:0 данных) словить офлайн-
// ошибку, query переходил в status:'error' — сами данные при этом НЕ
// стирались (query-core error-редьюсер не трогает state.data), но фильтр их
// выбрасывал из следующего дампа, и idbSet целиком переписывал снимок без
// них. На следующем холодном старте restoreQueryCache находил уже пустое
// место вместо рабочего кэша. Теперь берём по data!==undefined (доживает
// последний удачный результат, даже если самая свежая попытка провалилась),
// и donashivaем ключи, которых сейчас нет в живом кэше (компонент
// размонтировался и query собрал gc по gcTime) — из СТАРОГО снимка, а не
// выбрасываем. Итог: снимок только растёт/обновляется по ключу, никогда не
// мельчает между сессиями, пока сам не протухнет целиком (MAX_AGE_MS).
export function persistQueryCache(qc: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  const dump = async () => {
    const merged = new Map<string, { key: unknown; state: { data: unknown } }>()

    const prev = await idbGet<Snapshot>(STORE_QUERYCACHE, CACHE_KEY)
    if (prev && Date.now() - prev.savedAt <= MAX_AGE_MS) {
      for (const entry of prev.queries) {
        if (!Array.isArray(entry.key)) continue
        merged.set(JSON.stringify(entry.key), entry as { key: unknown; state: { data: unknown } })
      }
    }

    for (const q of qc.getQueryCache().getAll()) {
      if (!shouldPersist(q.queryKey) || q.state.data === undefined) continue
      merged.set(JSON.stringify(q.queryKey), { key: q.queryKey, state: { data: q.state.data } })
    }

    const snap: Snapshot = { savedAt: Date.now(), queries: [...merged.values()] }
    void idbSet(STORE_QUERYCACHE, CACHE_KEY, snap)
  }

  const unsub = qc.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void dump(), 1500)
  })

  return () => {
    if (timer) clearTimeout(timer)
    unsub()
  }
}
