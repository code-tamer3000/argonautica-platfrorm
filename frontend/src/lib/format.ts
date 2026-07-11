import { format, isSameDay, isToday, isYesterday } from 'date-fns'
import { ru } from 'date-fns/locale'

export const timeHM = (iso: string): string => format(new Date(iso), 'HH:mm')

// События календаря привязаны к московскому времени: показываем их всем в МСК,
// а не в локальной зоне зрителя (иначе у людей из разных зон время «съезжает»).
const MSK_TIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const MSK_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const MSK_DATETIME = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// «HH:mm» по Москве, без суффикса (суффикс МСК навешивает вызывающий код).
export const timeHMMsk = (iso: string): string => MSK_TIME.format(new Date(iso))

// «dd.MM.yyyy, HH:mm МСК» — полная дата-время события по Москве.
export const dateTimeMsk = (iso: string): string => `${MSK_DATETIME.format(new Date(iso))} МСК`

// Ключ дня «yyyy-MM-dd» по Москве — чтобы событие попало в правильную ячейку
// календаря независимо от зоны браузера.
export const dayKeyMsk = (iso: string): string => MSK_DAY.format(new Date(iso))

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

/**
 * Русская форма слова по числу: `plural(n, ['ответ', 'ответа', 'ответов'])`.
 * Формы — [1 / 2–4 / 5–20], по обычным правилам склонения (11–14 → «ответов»).
 */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  const d = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (d > 1 && d < 5) return forms[1]
  if (d === 1) return forms[0]
  return forms[2]
}
