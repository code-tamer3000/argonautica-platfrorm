import { useEffect, useState } from 'react'
import { useOfflinePreviewSrc } from '../hooks/useOfflinePreviewSrc'
import { initials } from '../lib/format'

interface Props {
  name: string
  url?: string | null
  size?: number
  square?: boolean
}

export function Avatar({ name, url, size = 36, square = false }: Props) {
  const radius = square ? 'var(--radius-btn)' : '50%'
  // Офлайн-кэш байт (ARG-152, тот же механизм, что у вложений чата — ARG-149):
  // avatar_url сам по себе уже превью (thumb_key ≤1024px, presigned), полного
  // оригинала как отдельной сущности нет, поэтому cacheable всегда true.
  const resolvedUrl = useOfflinePreviewSrc(url ?? null, true)
  // Офлайн (или протухший кэш до фонового /me) картинка не долетает и в кэше её
  // тоже нет — вместо сломанной иконки браузера показываем инициалы. Тот же
  // <img> не переотправит запрос сам, даже когда сеть вернётся (браузеры не
  // ретраят упавший src) — поэтому по событию 'online' сбрасываем ошибку и
  // даём <img> попытаться снова.
  const [broken, setBroken] = useState(false)
  // Сброс именно на resolvedUrl, а не только на исходный url-проп: реальный
  // <img> с «сырым» presigned-URL офлайн падает СИНХРОННО и почти мгновенно
  // (setBroken(true) вызывается сразу), а useOfflinePreviewSrc подменяет src
  // на закэшированный blob АСИНХРОННО (через IndexedDB, это дольше одного
  // тика) — broken успевал зафиксироваться в true ДО того, как resolvedUrl
  // сменится на рабочий blob:, и рендер условие `resolvedUrl && !broken`
  // навсегда оставалось ложным даже при реально закэшированных байтах
  // (баг, из-за которого ни одна аватарка не показывалась офлайн, ARG-152).
  useEffect(() => {
    setBroken(false)
  }, [resolvedUrl])
  useEffect(() => {
    const onOnline = () => setBroken(false)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  if (resolvedUrl && !broken) {
    return (
      <img
        src={resolvedUrl}
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
