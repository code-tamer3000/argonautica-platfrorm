import { useCallback, useLayoutEffect, useRef } from 'react'

// Авторастущая textarea: высота подстраивается под содержимое (от min до max),
// дальше включается внутренний скролл. Возвращает ref для textarea и функцию,
// которую надо звать при каждом изменении value (в onChange). Работает и при
// первом рендере/восстановлении черновика — через useLayoutEffect на value.
export function useAutoGrow(value: string, maxPx = 320) {
  const ref = useRef<HTMLTextAreaElement | null>(null)

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    // Сброс до auto, чтобы scrollHeight посчитался от контента, а не от текущей
    // (возможно завышенной) высоты.
    el.style.height = 'auto'
    const next = Math.min(el.scrollHeight, maxPx)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [maxPx])

  useLayoutEffect(resize, [value, resize])

  return { ref, resize }
}
