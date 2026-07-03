import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './chat.module.css'

export interface MenuItem {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
}

interface Props {
  // Позиция сообщения-якоря (координаты вьюпорта — меню position: fixed).
  anchor: DOMRect
  items: MenuItem[]
  onClose: () => void
}

const MARGIN = 8

// Всплывающее меню действий над сообщением (Telegram-style). Рендерится в портале
// поверх всего, с backdrop-ом для закрытия по клику вне и Escape. Позиция считается
// от прямоугольника сообщения с клампом по вьюпорту.
export function MessageActionsMenu({ anchor, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // По горизонтали — от левого края сообщения, с клампом в вьюпорт.
    let left = anchor.left
    if (left + width + MARGIN > vw) left = vw - width - MARGIN
    if (left < MARGIN) left = MARGIN
    // По вертикали — под сообщением; если не влезает — над ним.
    let top = anchor.bottom + 4
    if (top + height + MARGIN > vh) {
      top = anchor.top - height - 4
      if (top < MARGIN) top = Math.max(MARGIN, vh - height - MARGIN)
    }
    setPos({ top, left })
  }, [anchor])

  return createPortal(
    <div className={styles.menuBackdrop} onClick={onClose}>
      <div
        ref={menuRef}
        className={styles.menu}
        style={
          pos
            ? { top: pos.top, left: pos.left, visibility: 'visible' }
            : { visibility: 'hidden' }
        }
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <button
            key={it.key}
            className={`${styles.menuItem} ${it.danger ? styles.menuItemDanger : ''}`}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            <span className={styles.menuItemIcon}>{it.icon}</span>
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
