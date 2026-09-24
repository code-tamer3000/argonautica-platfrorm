import { useEffect, useState } from 'react'
import { initials } from '../lib/format'

interface Props {
  name: string
  url?: string | null
  size?: number
  square?: boolean
}

export function Avatar({ name, url, size = 36, square = false }: Props) {
  const radius = square ? 'var(--radius-btn)' : '50%'
  // Офлайн (или протухший кэш до фонового /me) картинка не долетает — вместо
  // сломанной иконки браузера показываем инициалы. Тот же <img> не переотправит
  // запрос сам, даже когда сеть вернётся (браузеры не ретраят упавший src) —
  // поэтому по событию 'online' сбрасываем ошибку и даём <img> попытаться снова.
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [url])
  useEffect(() => {
    const onOnline = () => setBroken(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (url && !broken) {
    return (
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
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
