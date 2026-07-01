import { create } from 'zustand'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, kind?: 'info' | 'error') => void
  dismiss: (id: number) => void
}

let seq = 1

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (text, kind = 'info') => {
    const id = seq++
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = (text: string, kind?: 'info' | 'error'): void =>
  useToasts.getState().push(text, kind)
