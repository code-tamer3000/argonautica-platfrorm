import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import type { EditableHandle } from './EditableInput'
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
  /** Индекс @ в тексте (для замены). */
  at: number
  /** Уже введённый после @ фрагмент (в нижнем регистре). */
  query: string
}

function findActiveMention(value: string, caret: number): MentionState | null {
  const before = value.slice(0, caret)
  const m = before.match(AT_TOKEN_RE)
  if (!m) return null
  // Позиция @: конец совпадения минус длина «@query».
  const at = caret - (m[1].length + 1)
  return { at, query: m[1].toLowerCase() }
}

/**
 * @-автодополнение для textarea сообщения/ответа. Управляет попапом со списком
 * пользователей, вставляет `@username ` по выбору. Работает поверх обычного
 * value/onChange (контролируемый textarea). Отдаёт:
 *  - `popup` — готовый JSX списка (рисуем над полем ввода),
 *  - `onKeyDown` — перехватчик стрелок/Enter/Esc, который надо позвать ПЕРЕД
 *    обычным обработчиком (возвращает true, если событие «съедено»),
 *  - `onValueChange` — вызвать при каждом изменении текста, чтобы пересчитать токен.
 */
export function useMentionAutocomplete(
  // Поле ввода композера — contenteditable (EditableInput), но выставляет textarea-
  // совместимый хэндл (value/selectionStart/focus/setSelectionRange), поэтому логика
  // токенов ниже не меняется.
  textareaRef: RefObject<EditableHandle>,
  value: string,
  setValue: (next: string) => void,
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

  // Пересчёт активного токена после любого изменения текста/каретки.
  const refresh = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const next = findActiveMention(el.value, el.selectionStart ?? el.value.length)
    setMention(next)
    setActive(0)
  }, [textareaRef])

  const onValueChange = useCallback(() => {
    // Отложим на микротаск: к этому моменту selectionStart уже обновлён браузером.
    queueMicrotask(refresh)
  }, [refresh])

  const insert = useCallback(
    (user: PublicUserOut) => {
      if (!mention) return
      const el = textareaRef.current
      const caret = el?.selectionStart ?? value.length
      const before = value.slice(0, mention.at)
      const after = value.slice(caret)
      const inserted = `@${user.username} `
      const next = before + inserted + after
      setValue(next)
      setMention(null)
      // Каретку — сразу после вставленного ника с пробелом.
      const pos = before.length + inserted.length
      queueMicrotask(() => {
        const node = textareaRef.current
        if (node) {
          node.focus()
          node.setSelectionRange(pos, pos)
        }
      })
    },
    [mention, value, setValue, textareaRef],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>): boolean => {
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
          // onMouseDown (не click): не даём textarea потерять фокус до вставки.
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

  return { popup, onKeyDown, onValueChange }
}
