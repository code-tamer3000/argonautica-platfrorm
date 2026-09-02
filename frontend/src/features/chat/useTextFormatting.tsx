import { useCallback, useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { IconBold, IconItalic, IconUnderline } from '../../components/icons'
import styles from './chat.module.css'

type Mark = 'bold' | 'italic' | 'underline'

// Маркеры совпадают с парсером plain-режима (lib/messageText.tsx) и markdown-режима
// (lib/markdown.ts): `**bold**`, `*italic*`, `++underline++` — подчёркивания в markdown
// нет, `++` придумано, т.к. не конфликтует ни с обычным текстом, ни с `__x__` (у marked
// это тот же жирный, что и `**x**`).
const MARKERS: Record<Mark, { open: string; close: string; title: string; Icon: typeof IconBold }> = {
  bold: { open: '**', close: '**', title: 'Жирный (Ctrl+B)', Icon: IconBold },
  italic: { open: '*', close: '*', title: 'Курсив (Ctrl+I)', Icon: IconItalic },
  underline: { open: '++', close: '++', title: 'Подчёркнутый (Ctrl+U)', Icon: IconUnderline },
}
const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline']

interface SelectionState {
  start: number
  end: number
}

/**
 * Панель форматирования выделенного текста (жирный/курсив/подчёркнутый) над textarea
 * композера. Работает поверх обычного value/onChange (контролируемый textarea), как
 * useMentionAutocomplete — тот же контракт. Отдаёт:
 *  - `bar` — готовая панель кнопок (рисуем над полем ввода, видна только при непустом
 *    выделении),
 *  - `onKeyDown` — перехватчик Ctrl/Cmd+B/I/U (звать ПЕРЕД обычным обработчиком,
 *    возвращает true, если событие «съедено»),
 *  - `onFocus`/`onBlur`/`onSelect` — вызвать на соответствующих событиях textarea, чтобы
 *    пересчитать текущее выделение.
 */
export function useTextFormatting(
  textareaRef: RefObject<HTMLTextAreaElement>,
  value: string,
  setValue: (next: string) => void,
) {
  const [selection, setSelection] = useState<SelectionState | null>(null)

  const refresh = useCallback(() => {
    const el = textareaRef.current
    if (!el || document.activeElement !== el) {
      setSelection(null)
      return
    }
    setSelection({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 })
  }, [textareaRef])

  // Основной канал: document-level selectionchange ловит и мышь, и клавиатуру (Shift+
  // стрелки, Ctrl+A). onFocus/onBlur/onSelect ниже — подстраховка на момент фокуса.
  useEffect(() => {
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [refresh])

  const onFocus = refresh
  const onSelect = refresh
  const onBlur = useCallback(() => setSelection(null), [])

  const applyMark = useCallback(
    (mark: Mark) => {
      const el = textareaRef.current
      if (!el) return
      const start = el.selectionStart ?? 0
      const end = el.selectionEnd ?? 0
      if (start === end) return
      const { open, close } = MARKERS[mark]
      const selected = value.slice(start, end)
      // Пробелы по краям выделения выносим ЗА маркеры — "** текст **" не распознаётся
      // ни plain-парсером, ни marked, а "текст **окружённый** пробелами" распознаётся.
      const leadWs = selected.match(/^\s*/)![0]
      const trailWs = selected.match(/\s*$/)![0]
      const core = selected.slice(leadWs.length, selected.length - trailWs.length)
      if (!core) return

      const before = value.slice(0, start)
      const after = value.slice(end)

      // Тоггл: если ядро уже обёрнуто этим же маркером (внутри выделения, или маркер
      // стоит сразу снаружи — выделили только "внутренность") — снимаем, иначе ставим.
      const wrappedInside =
        core.startsWith(open) && core.endsWith(close) && core.length >= open.length + close.length
      const wrappedOutside = before.endsWith(open) && after.startsWith(close)

      let nextBefore = before
      let nextAfter = after
      let nextCore: string
      if (wrappedInside) {
        nextCore = core.slice(open.length, core.length - close.length)
      } else if (wrappedOutside) {
        nextBefore = before.slice(0, before.length - open.length)
        nextAfter = after.slice(close.length)
        nextCore = core
      } else {
        nextCore = `${open}${core}${close}`
      }

      const next = `${nextBefore}${leadWs}${nextCore}${trailWs}${nextAfter}`
      setValue(next)
      const nextStart = nextBefore.length + leadWs.length
      const nextEnd = nextStart + nextCore.length
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(nextStart, nextEnd)
      })
    },
    [textareaRef, value, setValue],
  )

  const isActive = useCallback(
    (mark: Mark): boolean => {
      if (!selection || selection.start === selection.end) return false
      const { open, close } = MARKERS[mark]
      const { start, end } = selection
      const core = value.slice(start, end).trim()
      if (core.startsWith(open) && core.endsWith(close) && core.length >= open.length + close.length) return true
      return value.slice(0, start).endsWith(open) && value.slice(end).startsWith(close)
    },
    [selection, value],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!(e.ctrlKey || e.metaKey)) return false
      const key = e.key.toLowerCase()
      const mark = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : null
      if (!mark) return false
      e.preventDefault()
      applyMark(mark)
      return true
    },
    [applyMark],
  )

  const show = selection != null && selection.end > selection.start
  const bar = show ? (
    <div className={styles.fmtBar} role="toolbar" aria-label="Форматирование текста">
      {MARK_ORDER.map((mark) => {
        const { title, Icon } = MARKERS[mark]
        return (
          <button
            key={mark}
            type="button"
            className={`${styles.fmtBtn} ${isActive(mark) ? styles.fmtBtnActive : ''}`}
            title={title}
            aria-label={title}
            // onMouseDown (не click) + preventDefault: не даём textarea потерять фокус
            // и выделение до применения начертания (как у мест использования упоминаний).
            onMouseDown={(e) => {
              e.preventDefault()
              applyMark(mark)
            }}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  ) : null

  return { bar, onKeyDown, onFocus, onBlur, onSelect }
}
