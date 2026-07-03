import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
  // Rich-вариант (уведомление): заголовок = имя автора, аватар и переход по клику.
  title?: string
  avatarName?: string
  avatarUrl?: string | null
  onClick?: () => void
}

// Данные для создания тоста (без id — присваивается стором).
export type ToastInput = Omit<Toast, 'id' | 'kind'> & { kind?: 'info' | 'error' }

interface ToastState {
  toasts: Toast[]
  push: (text: string, kind?: 'info' | 'error') => void
  notify: (t: ToastInput) => void
  dismiss: (id: number) => void
}

let seq = 1

export const useToasts = create<ToastState>((set) => {
  const add = (toast: Toast, ttl: number) => {
    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) })), ttl)
  }
  return {
    toasts: [],
    push: (text, kind = 'info') => add({ id: seq++, text, kind }, 3500),
    // Rich-тосты живут чуть дольше — их читают и по ним кликают.
    notify: (t) => add({ id: seq++, kind: 'info', ...t }, 6000),
    dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }
})

export const toast = (text: string, kind?: 'info' | 'error'): void =>
  useToasts.getState().push(text, kind)

export const notify = (t: ToastInput): void => useToasts.getState().notify(t)
