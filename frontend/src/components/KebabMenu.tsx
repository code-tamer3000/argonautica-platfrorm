import { useEffect, useRef, useState } from 'react'
import { IconKebab } from './icons'
import styles from './kebabMenu.module.css'

export interface KebabMenuItem {
  key: string
  label: string
  onClick: () => void
  danger?: boolean
}

// Универсальное меню «три точки» на карточке/в шапке — идиома из ProfileMenu
// (клик вне закрывает, role="menu"/"menuitem"). Карточки часто сами являются
// <Link> — триггер останавливает всплытие клика, иначе меню откроет ссылку.
export function KebabMenu({ items, ariaLabel = 'Действия' }: { items: KebabMenuItem[]; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <IconKebab size={18} />
      </button>

      {open && (
        <div className={styles.menu} role="menu" onClick={(e) => e.stopPropagation()}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={item.danger ? `${styles.item} ${styles.itemDanger}` : styles.item}
              onClick={(e) => {
                e.preventDefault()
                setOpen(false)
                item.onClick()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
