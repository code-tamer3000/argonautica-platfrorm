import { useLayoutEffect, useRef } from 'react'

// Textarea, растущая под содержимое: на каждое изменение value подгоняем height под
// scrollHeight. Пределы (min/max-height, overflow) задаются в CSS — большое сообщение
// раскрывает поле целиком, а совсем длинное упирается в max-height и начинает скроллиться.
export function useAutosize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return ref
}
