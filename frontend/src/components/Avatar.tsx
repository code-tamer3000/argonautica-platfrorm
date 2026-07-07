import { initials } from '../lib/format'

interface Props {
  name: string
  url?: string | null
  size?: number
  square?: boolean
}

export function Avatar({ name, url, size = 36, square = false }: Props) {
  const radius = square ? 'var(--radius-btn)' : '50%'
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        style={{ borderRadius: radius, objectFit: 'cover', flex: '0 0 auto', display: 'block' }}
      />
    )
  }
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--avatar-bg)',
        color: 'var(--avatar-fg)',
        boxShadow: 'inset 0 0 0 1px var(--divider-gold)',
        fontFamily: 'var(--font-t4)',
        fontSize: Math.round(size * 0.36),
        letterSpacing: '0.5px',
      }}
    >
      {initials(name)}
    </span>
  )
}
