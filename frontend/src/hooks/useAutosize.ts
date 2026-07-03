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
    // box-sizing: border-box — scrollHeight не включает бордер, поэтому высоту берём
    // как scrollHeight + бордеры (offsetHeight - clientHeight). Иначе поле оказывается
    // на пару пикселей ниже контента и скроллбар вылезает ещё до упора в max-height.
    const border = el.offsetHeight - el.clientHeight
    el.style.height = `${el.scrollHeight + border}px`
  }, [value])
  return ref
}
