import { useShipDecoStore } from '../../stores/shipDeco'
import styles from './headerDeco.module.css'

// Декоративный слой шапки: античный кораблик медленно проплывает насквозь и
// покачивается на волне, снизу — пояс из отдельных завитков-меандров, идущих в
// противофазе (реальная зыбь). Всё тонким золотым «призраком» за контентом.
// Кораблик — тот же SVG, что на сайте argonautica (fill=currentColor → золото).

// Кол-во завитков: с запасом на широкий десктоп; лишние просто уезжают под
// overflow:hidden шапки. Лента дублируется дрейфом (translateX -50%).
const CURL_COUNT = 64

function ShipSvg() {
  return (
    <svg viewBox="0 0 443.422 443.422" fill="currentColor" aria-hidden="true">
      <path d="M377.304,267.198l-10.193-1.374l7.6,6.934c7.332,6.714,11.543,16.241,11.543,26.125c0,19.557-15.9,35.481-35.465,35.481H224.934V298.81h89.918c18.102,0,31.783-6.665,40.716-19.809c37.221-54.787-21.776-205.645-24.321-212.034l-0.805-2.032H64.216l0.975,3.991c0.406,1.707,41.196,172.025,7.82,214.464c-4.739,6.048-10.657,8.974-18.102,8.974H41.342v6.446H218.48v35.554H55.973c-19.135,0-35.026-15.566-35.432-34.717l-0.187-9.527l-5.641,7.69C5.088,310.987,0,326.537,0,342.754v12.989c0,42.09,34.229,76.319,76.319,76.319h290.759c42.098,0,76.344-34.229,76.344-76.319v-12.989C443.422,304.72,415.004,272.222,377.304,267.198z" />
      <rect x="222.154" y="12.14" width="6.43" height="43.553" />
      <polygon points="234.583,12.92 234.583,44.63 298.92,12.92" />
    </svg>
  )
}

function CurlSvg() {
  return (
    <svg viewBox="0 0 30 22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M1 17 C 1 4, 24 4, 24 17 C 24 9, 13 9, 13 15 C 13 19, 21 19, 21 12" />
    </svg>
  )
}

export function HeaderDeco() {
  const enabled = useShipDecoStore((s) => s.enabled)
  if (!enabled) return null

  return (
    <div className={styles.deco} aria-hidden>
      <div className={styles.ship}>
        <div className={styles.hull}><ShipSvg /></div>
      </div>
      <div className={styles.waves}>
        <div className={styles.track}>
          {Array.from({ length: CURL_COUNT }, (_, i) => (
            <span
              key={i}
              className={styles.curl}
              // Противофаза у соседей + лёгкий бегущий сдвиг: волна «бежит», а
              // не поднимается сплошным поясом.
              style={{ animationDelay: `${((i % 2 === 0 ? 0 : -2.1) + (i % 4) * -0.28).toFixed(2)}s` }}
            >
              <CurlSvg />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
