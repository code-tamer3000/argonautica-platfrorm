import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconBold, IconItalic, IconUnderline } from '../../components/icons'
import styles from './chat.module.css'

type Mark = 'bold' | 'italic' | 'underline'

// document.execCommand формально deprecated в спеке, но остаётся единственным кросс-
// браузерным способом переключать инлайновое форматирование в contentEditable без
// собственного rich-text движка (которого в проекте нет и не нужно ради трёх начертаний).
// Тоггл (повторное нажатие снимает начертание) — встроенное поведение браузера, свою
// логику снятия/установки маркеров (как в текстовом варианте) писать не нужно.
const MARK_META: Record<Mark, { command: string; title: string; Icon: typeof IconBold }> = {
  bold: { command: 'bold', title: 'Жирный (Ctrl+B)', Icon: IconBold },
  italic: { command: 'italic', title: 'Курсив (Ctrl+I)', Icon: IconItalic },
  underline: { command: 'underline', title: 'Подчёркнутый (Ctrl+U)', Icon: IconUnderline },
}
const MARK_ORDER: Mark[] = ['bold', 'italic', 'underline']

/**
 * Панель форматирования выделенного текста (жирный/курсив/подчёркнутый) для
 * contentEditable-композера — WYSIWYG через document.execCommand, без маркеров в самом
 * поле ввода (маркеры **, *, ++ появляются только при сериализации в content на отправке,
 * см. lib/inlineMarks.ts). Отдаёт:
 *  - `bar` — панель кнопок, видна только при непустом выделении внутри поля,
 *  - `onKeyDown` — перехватчик Ctrl/Cmd+B/I/U (звать ПЕРЕД обычным обработчиком,
 *    возвращает true, если событие «съедено»),
 *  - `onFocus`/`onBlur`/`onSelect` — вызвать на соответствующих событиях поля.
 *
 * На тач-устройствах нативное меню выделения телефона — это ОС-слой ПОВЕРХ страницы
 * (z-index на него не действует), и оно перекрывает любой кастомный элемент рядом с
 * выделением. На iOS Safari это не проблема: WebKit сам добавляет Ж/К/Ч прямо в
 * системное меню для contentEditable, бесплатно. На Android такой интеграции нет —
 * там наша панель нужна, но чтобы не спорить за место с нативным пузырём, она уезжает
 * в фиксированную зону вверху экрана (.fmtBarMobile), а не висит над полем ввода.
 */
export function useRichFormatting(editorRef: RefObject<HTMLDivElement>, onApplied: () => void) {
  const [hasSelection, setHasSelection] = useState(false)
  const [active, setActive] = useState<Record<Mark, boolean>>({
    bold: false,
    italic: false,
    underline: false,
  })

  const refresh = useCallback(() => {
    const el = editorRef.current
    if (!el || document.activeElement !== el) {
      setHasSelection(false)
      return
    }
    const sel = window.getSelection()
    const nonEmpty = !!sel && sel.rangeCount > 0 && !sel.isCollapsed && el.contains(sel.anchorNode)
    setHasSelection(nonEmpty)
    if (nonEmpty) {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      })
    }
  }, [editorRef])

  // document-level selectionchange ловит и мышь, и клавиатуру (Shift+стрелки, Ctrl+A).
  useEffect(() => {
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [refresh])

  const onFocus = refresh
  const onSelect = refresh
  const onBlur = useCallback(() => setHasSelection(false), [])

  const applyMark = useCallback(
    (mark: Mark) => {
      const el = editorRef.current
      if (!el) return
      el.focus()
      // Без styleWithCSS=false некоторые браузеры оборачивают выделение
      // <span style="font-weight: 700"> вместо <b> — htmlToMarkerText (lib/inlineMarks.ts)
      // ищет по имени тега, спан с инлайновым стилем он не узнаёт, и сообщение уходит
      // без маркеров вовсе (текст визуально жирный в composer'е, но обычный после
      // отправки). Явно фиксируем тег-режим перед каждой командой — дёшево, идемпотентно.
      document.execCommand('styleWithCSS', false, 'false')
      document.execCommand(MARK_META[mark].command)
      onApplied()
      refresh()
    },
    [editorRef, onApplied, refresh],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): boolean => {
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

  const isCoarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  const buttons = MARK_ORDER.map((mark) => {
    const { title, Icon } = MARK_META[mark]
    return (
      <button
        key={mark}
        type="button"
        className={`${styles.fmtBtn} ${active[mark] ? styles.fmtBtnActive : ''}`}
        title={title}
        aria-label={title}
        // onMouseDown (не click) + preventDefault: не даём полю потерять фокус и
        // выделение до применения начертания.
        onMouseDown={(e) => {
          e.preventDefault()
          applyMark(mark)
        }}
      >
        <Icon size={16} />
      </button>
    )
  })

  let bar: ReactNode = null
  if (hasSelection && isCoarsePointer) {
    // Портал в document.body: .fmtBarMobile — position:fixed к реальному вьюпорту
    // экрана. Без портала браузер якорит fixed к ближайшему предку с активным
    // transform (а не обязательно к вьюпорту) — а у композера/пейна ЕСТЬ transform-
    // анимации входа (.paneEnter/.composerReveal, translateY при монтировании). Тогда
    // top/left считаются от бокса этого предка, а не от экрана — панель уезжала
    // «наполовину за край» именно поэтому, не из-за самой идеи «наверху».
    bar = createPortal(
      <div className={`${styles.fmtBar} ${styles.fmtBarMobile}`} role="toolbar" aria-label="Форматирование текста">
        {buttons}
      </div>,
      document.body,
    )
  } else if (hasSelection) {
    bar = (
      <div className={styles.fmtBar} role="toolbar" aria-label="Форматирование текста">
        {buttons}
      </div>
    )
  }

  return { bar, onKeyDown, onFocus, onBlur, onSelect }
}
