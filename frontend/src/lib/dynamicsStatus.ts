// Единый источник подписей/иконок статуса дня Динамики — используется и в
// админской Динамике (AdminDynamics), и в календаре профиля участника
// (ProfileScreen), чтобы они не разъезжались (ARG-126).
import type { DayStatus } from './types'

export const DAY_STATUS_ICON: Record<DayStatus, string> = {
  closed: '✓',
  credited: '✓',
  missed: '✗',
  pardoned: '~',
  partial: '◐',
  today_open: '○',
  today_closed: '✓',
  before_start: '·',
  upcoming: '·',
}

export const DAY_STATUS_TEXT: Record<DayStatus, string> = {
  closed: 'Выполнено',
  credited: 'Зачтено',
  missed: 'Пропущено',
  pardoned: 'Плавал с китами',
  partial: 'Частично выполнено',
  today_open: 'Сегодня',
  today_closed: 'Сегодня ✓',
  before_start: '—',
  upcoming: 'Впереди',
}
