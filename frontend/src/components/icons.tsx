import {
  ArrowUp,
  ArrowLeft,
  Bell,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  CornerUpLeft,
  Dna,
  Flame,
  LifeBuoy,
  MessageSquare,
  Megaphone,
  Mic,
  Moon,
  NotebookPen,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  ListChecks,
  Settings,
  Smile,
  Sticker,
  Sun,
  TriangleAlert,
  Trash2,
  User,
  Users,
  Waves,
  X,
  type LucideProps,
} from 'lucide-react'

// Иконки из Lucide (lucide.dev): 24×24, stroke=currentColor, round-линии — в духе
// дизайн-системы. Обёртки сохраняют прежние имена (IconChat и т.д.) и API `size`,
// поэтому места вызова менять не нужно. Дефолты — размер 22 и толщина 1.5.
export type IconProps = LucideProps & { size?: number }

const DEFAULTS: LucideProps = { size: 22, strokeWidth: 1.5, absoluteStrokeWidth: true }

export const IconChat = (p: IconProps) => <MessageSquare {...DEFAULTS} {...p} />
export const IconBook = (p: IconProps) => <BookOpen {...DEFAULTS} {...p} />
export const IconDiary = (p: IconProps) => <NotebookPen {...DEFAULTS} {...p} />
export const IconCalendar = (p: IconProps) => <Calendar {...DEFAULTS} {...p} />
export const IconUser = (p: IconProps) => <User {...DEFAULTS} {...p} />
export const IconSettings = (p: IconProps) => <Settings {...DEFAULTS} {...p} />
export const IconPin = (p: IconProps) => <Pin {...DEFAULTS} {...p} />
export const IconUsers = (p: IconProps) => <Users {...DEFAULTS} {...p} />
export const IconBack = (p: IconProps) => <ArrowLeft {...DEFAULTS} {...p} />
export const IconPlus = (p: IconProps) => <Plus {...DEFAULTS} {...p} />
export const IconAttach = (p: IconProps) => <Paperclip {...DEFAULTS} {...p} />
export const IconSmile = (p: IconProps) => <Smile {...DEFAULTS} {...p} />
export const IconSticker = (p: IconProps) => <Sticker {...DEFAULTS} {...p} />
export const IconChevronDown = (p: IconProps) => <ChevronDown {...DEFAULTS} {...p} />
export const IconChevronLeft = (p: IconProps) => <ChevronLeft {...DEFAULTS} {...p} />
export const IconChevronRight = (p: IconProps) => <ChevronRight {...DEFAULTS} {...p} />
export const IconNews = (p: IconProps) => <Megaphone {...DEFAULTS} {...p} />
export const IconBell = (p: IconProps) => <Bell {...DEFAULTS} {...p} />
export const IconSend = (p: IconProps) => <ArrowUp {...DEFAULTS} {...p} />
export const IconMic = (p: IconProps) => <Mic {...DEFAULTS} {...p} />
export const IconPlay = (p: IconProps) => <Play {...DEFAULTS} {...p} />
export const IconPause = (p: IconProps) => <Pause {...DEFAULTS} {...p} />
export const IconTrash = (p: IconProps) => <Trash2 {...DEFAULTS} {...p} />
export const IconClose = (p: IconProps) => <X {...DEFAULTS} {...p} />
export const IconReply = (p: IconProps) => <CornerUpLeft {...DEFAULTS} {...p} />
export const IconCopy = (p: IconProps) => <Copy {...DEFAULTS} {...p} />
export const IconEdit = (p: IconProps) => <Pencil {...DEFAULTS} {...p} />
export const IconFlame = (p: IconProps) => <Flame {...DEFAULTS} {...p} />
export const IconWaves = (p: IconProps) => <Waves {...DEFAULTS} {...p} />
export const IconCheck = (p: IconProps) => <CircleCheck {...DEFAULTS} {...p} />
export const IconAlert = (p: IconProps) => <TriangleAlert {...DEFAULTS} {...p} />
export const IconSupport = (p: IconProps) => <LifeBuoy {...DEFAULTS} {...p} />
export const IconTasks = (p: IconProps) => <ListChecks {...DEFAULTS} {...p} />
export const IconGenkeys = (p: IconProps) => <Dna {...DEFAULTS} {...p} />
export const IconSun = (p: IconProps) => <Sun {...DEFAULTS} {...p} />
export const IconMoon = (p: IconProps) => <Moon {...DEFAULTS} {...p} />
