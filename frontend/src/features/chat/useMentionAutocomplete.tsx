import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useUsers } from '../../api/users'
import { Avatar } from '../../components/Avatar'
import type { PublicUserOut } from '../../lib/types'
import styles from './chat.module.css'

// Активный @-токен под курсором: @ на границе слова + буквы/цифры/_ до каретки.
// Требуем, чтобы перед @ был пробел/начало строки — иначе это e-mail и т.п.
const AT_TOKEN_RE = /(?:^|\s)@([A-Za-z0-9_]*)$/
// Платформа маленькая (≈20–30 человек), поэтому в попапе показываем всех подходящих —
// список скроллится (max-height у .mentionPop). Раньше стоял жёсткий лимит 6: на
// канале с непустым составом остальных участников просто нельзя было выбрать —
// они молча отсекались, а не уезжали под скролл.
const MAX_SUGGESTIONS = 50

interface MentionState {
  /** Текстовый узел DOM, в котором сейчас набирается «@ник» (для замены на месте). */
  node: Text
  /** Индекс @ внутри node.textContent. */
  at: number
  /** Уже введённый после @ фрагмент (в нижнем регистре). */
  query: string
}

// caret — offset каретки ВНУТРИ node (не во всём тексте композера — при contentEditable
// с несколькими текстовыми узлами/тегами <b>/<i>/<u> глобального offset просто нет,
// зато offset внутри одного текстового узла Selection API отдаёт напрямую).
function findActiveMention(node: Text, caret: number): MentionState | null {
  const full = node.textContent ?? ''
  const before = full.slice(0, caret)
  const m = before.match(AT_TOKEN_RE)
  if (!m) return null
  const at = caret - (m[1].length + 1)
  return { node, at, query: m[1].toLowerCase() }
}

/**
 * @-автодополнение для contentEditable-композера. Управляет попапом со списком
 * пользователей, вставляет `@username ` прямо в DOM на месте курсора (Selection/Range
 * API — в contentEditable нет единой строки value/selectionStart, как у textarea).
 * Отдаёт:
 *  - `popup` — готовый JSX списка (рисуем над полем ввода),
 *  - `onKeyDown` — перехватчик стрелок/Enter/Esc/Tab, который надо позвать ПЕРЕД
 *    обычным обработчиком (возвращает true, если событие «съедено»),
 *  - `onSelectionChange` — вызвать на selectionchange/input поля, чтобы пересчитать токен.
 */
export function useMentionAutocomplete(
  editorRef: RefObject<HTMLDivElement>,
  onInserted: () => void,
) {
  const { data: users } = useUsers()
  const [mention, setMention] = useState<MentionState | null>(null)
  const [active, setActive] = useState(0)
  // Активная опция — держим её видимой при листании стрелками (список скроллится).
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const candidates = useMemo(() => {
    if (!mention || !users) return []
    const q = mention.query
    const scored = users.filter(
      (u) =>
        u.username.toLowerCase().startsWith(q) ||
        u.display_name.toLowerCase().includes(q),
    )
    return scored.slice(0, MAX_SUGGESTIONS)
  }, [mention, users])

  const open = mention != null && candidates.length > 0

  // Пересчёт активного токена после любого изменения текста/каретки. Работает только
  // когда каретка стоит ВНУТРИ текстового узла (обычный случай набора текста) — если
  // выделение охватывает диапазон или указывает прямо на элемент (границы <b>/<i>),
  // автодополнение просто не открывается, это не баг, а деградация как у @/URL-парсера
  // в lib/messageText.tsx.
  const refresh = useCallback(() => {
    const el = editorRef.current
    if (!el || document.activeElement !== el) {
      setMention(null)
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      setMention(null)
      return
    }
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) {
      setMention(null)
      return
    }
    const next = findActiveMention(node as Text, range.startOffset)
    setMention(next)
    setActive(0)
  }, [editorRef])

  const onSelectionChange = useCallback(() => {
    // Отложим на микротаск: к этому моменту DOM/каретка уже обновлены браузером.
    queueMicrotask(refresh)
  }, [refresh])

  const insert = useCallback(
    (user: PublicUserOut) => {
      if (!mention) return
      const { node, at, query } = mention
      // Живой caret на момент вставки: если ничего не изменилось с последнего refresh —
      // это at + «@» + query; берём live-значение, если каретка всё ещё в этом же узле.
      const sel = window.getSelection()
      const liveRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
      const caret =
        liveRange && liveRange.startContainer === node
          ? liveRange.startOffset
          : at + 1 + query.length
      const full = node.textContent ?? ''
      const before = full.slice(0, at)
      const after = full.slice(caret)
      const inserted = `@${user.username} `
      node.textContent = before + inserted + after
      const pos = before.length + inserted.length
      const range = document.createRange()
      range.setStart(node, pos)
      range.collapse(true)
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(range)
      setMention(null)
      onInserted()
    },
    [mention, onInserted],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>): boolean => {
      if (!open) return false
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % candidates.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + candidates.length) % candidates.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(candidates[active])
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return true
      }
      return false
    },
    [open, candidates, active, insert],
  )

  const popup = open ? (
    <div className={styles.mentionPop} role="listbox">
      {candidates.map((u, i) => (
        <button
          key={u.id}
          ref={i === active ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`${styles.mentionOption} ${i === active ? styles.mentionOptionActive : ''}`}
          // onMouseDown (не click): не даём полю потерять фокус до вставки.
          onMouseDown={(e) => {
            e.preventDefault()
            insert(u)
          }}
          onMouseEnter={() => setActive(i)}
        >
          <Avatar name={u.display_name} url={u.avatar_url} size={26} />
          <span className={styles.mentionName}>{u.display_name}</span>
          <span className={styles.mentionHandle}>@{u.username}</span>
        </button>
      ))}
    </div>
  ) : null

  return { popup, onKeyDown, onSelectionChange }
}
