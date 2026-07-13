import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from 'react'

/*
 * Поле ввода композера на contenteditable — а НЕ на <textarea>.
 *
 * Зачем: iOS Safari над клавиатурой рисует нативную панель аксессуаров (стрелки ↑↓ +
 * «Готово») для любых <input>/<textarea>. Убрать её штатными атрибутами нельзя, а она
 * съедает ~44px и перекрывает низ композера. Для contenteditable-элемента iOS эту
 * панель НЕ показывает — поле встаёт впритык над клавиатурой.
 *
 * Наружу притворяемся textarea: ref отдаёт объект с теми же членами, что читают
 * потребители (@-автодополнение и восстановление черновика) — value / selectionStart /
 * focus() / setSelectionRange(). Так их код остаётся textarea-совместимым.
 */

// Минимальный textarea-подобный хэндл: ровно то, что читают Composer и
// useMentionAutocomplete. Не тащим весь HTMLTextAreaElement — только нужное.
export interface EditableHandle {
  value: string
  selectionStart: number
  focus(): void
  setSelectionRange(start: number, end: number): void
}

interface Props {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  onFocus?: () => void
  placeholder?: string
  className?: string
  ariaLabel?: string
}

/** Плоский текст contenteditable: собираем textContent, а разрывы строк (<div>/<br>,
 *  которые браузер вставляет на Enter) сводим к '\n'. */
function readPlainText(el: HTMLElement): string {
  const text = el.innerText
  // innerText уже отдаёт переводы строк за <div>/<br>; нормализуем CRLF и хвостовой \n,
  // который браузер иногда добавляет за финальным блоком.
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
}

/** Смещение каретки как индекс в плоском тексте (учитывает переводы строк как 1 символ). */
function getCaretOffset(root: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return readPlainText(root).length
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return readPlainText(root).length
  // Диапазон от начала поля до каретки → его текст даёт смещение в плоском тексте.
  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().replace(/\r\n?/g, '\n').length
}

/** Поставить каретку на смещение offset в плоском тексте (проходим текстовые узлы). */
function setCaretOffset(root: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode() as Text | null
  const range = document.createRange()
  if (!node) {
    // Поле пустое — каретка в сам контейнер.
    range.selectNodeContents(root)
    range.collapse(true)
  } else {
    let placed = false
    while (node) {
      const len = node.length
      if (remaining <= len) {
        range.setStart(node, remaining)
        placed = true
        break
      }
      remaining -= len
      const next = walker.nextNode() as Text | null
      if (!next) {
        // Смещение за концом — ставим в конец последнего узла.
        range.setStart(node, len)
        placed = true
        break
      }
      node = next
    }
    if (!placed) range.setStart(node!, (node as Text).length)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

export const EditableInput = forwardRef<EditableHandle, Props>(function EditableInput(
  { value, onChange, onKeyDown, onFocus, placeholder, className, ariaLabel },
  ref,
) {
  const elRef = useRef<HTMLDivElement>(null)

  // Textarea-совместимый хэндл для потребителей (@-меншены, восстановление черновика).
  useImperativeHandle(
    ref,
    () => ({
      get value() {
        const el = elRef.current
        return el ? readPlainText(el) : ''
      },
      get selectionStart() {
        const el = elRef.current
        return el ? getCaretOffset(el) : 0
      },
      focus() {
        elRef.current?.focus()
      },
      setSelectionRange(start: number) {
        const el = elRef.current
        if (el) setCaretOffset(el, start)
      },
    }),
    [],
  )

  // Контролируемость: если проп value разошёлся с DOM (сброс после отправки, вставка
  // черновика, выбор @-ника), пишем текст в DOM и восстанавливаем каретку в конец
  // вставленного. Во время обычного набора value === DOM — не трогаем (иначе прыгала бы
  // каретка). Сравниваем по плоскому тексту.
  useLayoutEffect(() => {
    const el = elRef.current
    if (!el) return
    if (readPlainText(el) === value) return
    const hadFocus = document.activeElement === el
    el.textContent = value
    if (hadFocus) setCaretOffset(el, value.length)
  }, [value])

  const handleInput = useCallback(() => {
    const el = elRef.current
    if (el) onChange(readPlainText(el))
  }, [onChange])

  return (
    <div
      ref={elRef}
      className={className}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      data-placeholder={placeholder}
      data-empty={value.length === 0 ? 'true' : undefined}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      // enterKeyHint убирает «переход» на Enter-кнопке клавиатуры (перевод строки, не отправка).
      enterKeyHint="enter"
    />
  )
})
