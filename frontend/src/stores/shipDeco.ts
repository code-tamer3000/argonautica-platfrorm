// Декор в шапке: плывущий кораблик + волна-меандр. Кому-то анимация мешает —
// даём выключатель в профиле. Выбор храним в localStorage (как тема). По
// умолчанию включено. Reduced-motion гасит саму анимацию отдельно, на уровне CSS.
import { create } from 'zustand'

const STORAGE_KEY = 'arg-ship-deco'

function readStored(): boolean {
  try {
    // Отсутствие ключа = включено (дефолт). Выключено только при явном 'off'.
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

interface ShipDecoState {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

export const useShipDecoStore = create<ShipDecoState>((set) => ({
  enabled: readStored(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off')
    } catch {
      /* приватный режим — применим на сессию через стор */
    }
    set({ enabled: v })
  },
}))
