// Рукодельный 4-лучевой золотой блик (перенесён из сайта argonautica). Заменяет
// Lucide-звезду — та выглядела чужеродно. Цвет наследуется от currentColor, так
// что достаточно задать color на родителе. Мерцание/масштаб — снаружи через CSS.
//
// variant="icon" — брендовая PNG/WEBP-иконка звезды (перенесена с сайта
// argonautica, где она заменила эту же SVG-звезду). У неё свой золотой цвет и
// drop-shadow-блик, currentColor не наследует — используется там, где нужен
// фирменный вид, а не тонировка под текст (хедер платформы, логин-экран).
interface Props {
  size?: number
  className?: string
  variant?: 'glyph' | 'icon'
}

export function StarSpark({ size = 14, className, variant = 'glyph' }: Props) {
  if (variant === 'icon') {
    return (
      <img
        src="/media/star.webp"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className={className}
        style={{
          display: 'block', flexShrink: 0, objectFit: 'contain',
          filter: 'drop-shadow(0 0 3px rgba(214,172,64,0.55))',
        }}
      />
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="-11 -11 22 22"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        d="M0,-10 C1.5,-3 3,-1.5 10,0 C3,1.5 1.5,3 0,10 C-1.5,3 -3,1.5 -10,0 C-3,-1.5 -1.5,-3 0,-10 Z"
        fill="currentColor"
      />
    </svg>
  )
}
