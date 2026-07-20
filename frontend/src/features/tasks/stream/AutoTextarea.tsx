import { useEffect, useRef, type TextareaHTMLAttributes } from 'react'
import styles from './stream.module.css'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Стартовая высота в строках; дальше поле растёт под текст. */
  minRows?: number
}

/**
 * Текстовое поле, растущее под содержимое: в потоке пишут абзацы, а не строчку,
 * и скролл внутри маленького окошка мешает перечитывать себя перед сдачей.
 *
 * Высоту считаем на каждый рендер (не только на ввод) — иначе поле, которому текст
 * пришёл извне (черновик с сервера), осталось бы в одну строку.
 */
export function AutoTextarea({ minRows = 4, className = '', ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [rest.value])

  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={`${styles.field} ${className}`.trim()}
      {...rest}
    />
  )
}
