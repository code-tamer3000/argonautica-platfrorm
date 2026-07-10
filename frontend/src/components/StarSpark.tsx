// Рукодельный 4-лучевой золотой блик (перенесён из сайта argonautica). Заменяет
// Lucide-звезду — та выглядела чужеродно. Цвет наследуется от currentColor, так
// что достаточно задать color на родителе. Мерцание/масштаб — снаружи через CSS.
interface Props {
  size?: number
  className?: string
}

export function StarSpark({ size = 14, className }: Props) {
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
