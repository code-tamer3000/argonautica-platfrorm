// Черновики композера: несохранённый текст живёт в IndexedDB по комнатам, чтобы
// не пропадал при переключении вкладок, случайном закрытии или перезагрузке.
// Восстанавливается при открытии комнаты, стирается после успешной постановки
// сообщения в очередь отправки.
import { idbDelete, idbGet, idbSet, STORE_DRAFTS } from './idb'

const key = (roomId: number): string => `room:${roomId}`

// Записи дебаунсим — печатать в IndexedDB на каждый keystroke ни к чему.
const timers: Record<number, ReturnType<typeof setTimeout>> = {}
const DEBOUNCE_MS = 400

export function saveDraft(roomId: number, text: string): void {
  if (timers[roomId]) clearTimeout(timers[roomId])
  timers[roomId] = setTimeout(() => {
    const value = text.trim()
    if (value) void idbSet(STORE_DRAFTS, key(roomId), value)
    else void idbDelete(STORE_DRAFTS, key(roomId))
  }, DEBOUNCE_MS)
}

export function loadDraft(roomId: number): Promise<string | undefined> {
  return idbGet<string>(STORE_DRAFTS, key(roomId))
}

export function clearDraft(roomId: number): void {
  if (timers[roomId]) {
    clearTimeout(timers[roomId])
    delete timers[roomId]
  }
  void idbDelete(STORE_DRAFTS, key(roomId))
}
