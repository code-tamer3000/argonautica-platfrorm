import type { SVGProps } from 'react'

// Набор inline-SVG в духе дизайн-системы: острые формы, без заливки,
// stroke = currentColor (подсветка активного таба/состояния наследуется от цвета текста).
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 22, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5h16v11H8l-4 4z" />
    </Svg>
  )
}

export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h7v16H4z" />
      <path d="M13 4h7v16h-7z" />
      <path d="M11 4v16" />
    </Svg>
  )
}

export function IconCalendar(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16v14H4z" />
      <path d="M4 10h16" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </Svg>
  )
}

export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4l4 4-4 4-4-4z" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </Svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l2 3 3.5-.5L17 9l3 3-3 3 .5 3.5L14 18l-2 3-2-3-3.5.5L7 15l-3-3 3-3-.5-3.5L10 6z" />
      <path d="M12 9.5l2.5 2.5L12 14.5 9.5 12z" />
    </Svg>
  )
}

export function IconPin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
      <path d="M12 14v7" />
    </Svg>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4l3 3-3 3-3-3z" />
      <path d="M2 19c0-2.8 2.4-5 6-5s6 2.2 6 5" />
      <path d="M16 5l2.5 2.5L16 10" />
      <path d="M16 14c3 .3 5 2.4 5 5" />
    </Svg>
  )
}

export function IconBack(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}

export function IconAttach(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 11l-7.5 7.5a4 4 0 01-5.5-5.5L13 5.5a2.5 2.5 0 013.5 3.5L9 16.5" />
    </Svg>
  )
}

export function IconSmile(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16v16H4z" />
      <path d="M8.5 14c.9 1.2 2.1 2 3.5 2s2.6-.8 3.5-2" />
      <path d="M9 9.5h.01" />
      <path d="M15 9.5h.01" />
    </Svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 6l-6 6 6 6" />
    </Svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 6l6 6-6 6" />
    </Svg>
  )
}
