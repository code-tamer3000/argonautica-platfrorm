// Черновики форм «Каюты»: несохранённые поля новой записи живут в IndexedDB по
// подразделам (kind), чтобы не пропадать при закрытии формы, переключении
// вкладок или перезагрузке. Аналог lib/drafts.ts для чата, но значение —
// не строка, а весь объект формы (Record<string, string | number>).
//
// Черновики ведём только для НОВЫХ записей (не для редактирования существующих):
// у правки уже есть источник истины на сервере, терять там нечего.
import { idbDelete, idbGet, idbSet, STORE_CABIN_DRAFTS } from './idb'
import type { CabinKind } from './types'

export type CabinDraft = Record<string, string | number>

const key = (kind: CabinKind): string => `kind:${kind}`

// Пишем с дебаунсом — незачем трогать IndexedDB на каждое нажатие.
const timers: Partial<Record<CabinKind, ReturnType<typeof setTimeout>>> = {}
const DEBOUNCE_MS = 400

export function saveCabinDraft(kind: CabinKind, draft: CabinDraft): void {
  const t = timers[kind]
  if (t) clearTimeout(t)
  timers[kind] = setTimeout(() => {
    void idbSet(STORE_CABIN_DRAFTS, key(kind), draft)
  }, DEBOUNCE_MS)
}

export function loadCabinDraft(kind: CabinKind): Promise<CabinDraft | undefined> {
  return idbGet<CabinDraft>(STORE_CABIN_DRAFTS, key(kind))
}

export function clearCabinDraft(kind: CabinKind): void {
  const t = timers[kind]
  if (t) {
    clearTimeout(t)
    delete timers[kind]
  }
  void idbDelete(STORE_CABIN_DRAFTS, key(kind))
}
