import {
  ArrowUp,
  ArrowLeft,
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Megaphone,
  Paperclip,
  Pin,
  Plus,
  Settings,
  Smile,
  User,
  Users,
  type LucideProps,
} from 'lucide-react'

// Иконки из Lucide (lucide.dev): 24×24, stroke=currentColor, round-линии — в духе
// дизайн-системы. Обёртки сохраняют прежние имена (IconChat и т.д.) и API `size`,
// поэтому места вызова менять не нужно. Дефолты — размер 22 и толщина 1.5.
export type IconProps = LucideProps & { size?: number }

const DEFAULTS: LucideProps = { size: 22, strokeWidth: 1.5, absoluteStrokeWidth: true }

export const IconChat = (p: IconProps) => <MessageSquare {...DEFAULTS} {...p} />
export const IconBook = (p: IconProps) => <BookOpen {...DEFAULTS} {...p} />
export const IconCalendar = (p: IconProps) => <Calendar {...DEFAULTS} {...p} />
export const IconUser = (p: IconProps) => <User {...DEFAULTS} {...p} />
export const IconSettings = (p: IconProps) => <Settings {...DEFAULTS} {...p} />
export const IconPin = (p: IconProps) => <Pin {...DEFAULTS} {...p} />
export const IconUsers = (p: IconProps) => <Users {...DEFAULTS} {...p} />
export const IconBack = (p: IconProps) => <ArrowLeft {...DEFAULTS} {...p} />
export const IconPlus = (p: IconProps) => <Plus {...DEFAULTS} {...p} />
export const IconAttach = (p: IconProps) => <Paperclip {...DEFAULTS} {...p} />
export const IconSmile = (p: IconProps) => <Smile {...DEFAULTS} {...p} />
export const IconChevronLeft = (p: IconProps) => <ChevronLeft {...DEFAULTS} {...p} />
export const IconChevronRight = (p: IconProps) => <ChevronRight {...DEFAULTS} {...p} />
export const IconNews = (p: IconProps) => <Megaphone {...DEFAULTS} {...p} />
export const IconSend = (p: IconProps) => <ArrowUp {...DEFAULTS} {...p} />
