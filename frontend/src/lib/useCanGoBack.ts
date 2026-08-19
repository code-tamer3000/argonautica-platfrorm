import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

// React Router нумерует записи своей истории в `history.state.idx`: 0 — самый
// первый экран вкладки, дальше +1 на каждый переход. idx > 0 означает, что внутри
// платформы есть куда возвращаться и «Назад» не выкинет человека на предыдущий сайт.
//
// Значение читаем из живого `window.history`, а не из состояния React, поэтому
// пересчитываем на каждой смене маршрута: `location.key` меняется при любом
// переходе, включая переходы вперёд-назад по истории.
export function useCanGoBack(): boolean {
  const { key } = useLocation()

  return useMemo(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    return typeof idx === 'number' && idx > 0
  }, [key])
}
