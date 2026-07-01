import { format, isSameDay, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'

export const timeHM = (iso: string): string => format(new Date(iso), 'HH:mm')

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return 'Сегодня'
  if (isYesterday(d)) return 'Вчера'
  return format(d, 'd MMMM', { locale: ru })
}

export const sameDay = (a: string, b: string): boolean => isSameDay(new Date(a), new Date(b))

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.trim().slice(0, 2).toUpperCase()
}
