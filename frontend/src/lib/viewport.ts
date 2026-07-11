/*
 * Стабилизация мобильного вьюпорта под экранную клавиатуру (в первую очередь iOS).
 *
 * Что делает iOS Safari при фокусе на поле: сжимает visual viewport (клавиатура) И
 * прокручивает документ вверх, чтобы «показать» поле — утаскивая наш фикс-слой (#root)
 * за верхний край экрана. В итоге композер прилипает к верху, а между ним и клавой —
 * пустота.
 *
 * Решение:
 *  1) #root — position:fixed на всю ВИДИМУЮ область (см. global.css): top:0 +
 *     height = --app-height (= visualViewport.height). Композер в самом низу #root
 *     оказывается ровно над клавиатурой.
 *  2) НЕ ДАЁМ документу прокрутиться: любой скролл окна/документа синхронно возвращаем
 *     в ноль. Важно делать это на КАЖДОМ scroll-событии сразу (а не по таймауту), иначе
 *     iOS успевает плавно уехать вверх, и возврат выглядит как рывок/«мячик».
 */

// Порог (px), выше которого сжатие visual viewport считаем открытой клавиатурой.
const KEYBOARD_THRESHOLD = 120

let installed = false
let lastHeight = 0

/** Синхронно вернуть окно/документ к нулевому скроллу — гасим нативный «scroll to field». */
function pinScroll() {
  // window и scrollingElement оба могут «уехать» на iOS — сбрасываем оба.
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
  const se = document.scrollingElement
  if (se && se.scrollTop !== 0) se.scrollTop = 0
  if (document.body.scrollTop !== 0) document.body.scrollTop = 0
}

function applyHeight() {
  const vv = window.visualViewport
  const height = vv ? vv.height : window.innerHeight
  const root = document.documentElement

  // Обновляем --app-height только при заметном изменении (>2px): во время анимации
  // выезда клавиатуры visualViewport шлёт десятки resize-событий на суб-пиксельных
  // высотах — каждое пере-раскладывало бы весь макет. Округляем и гасим микро-дрожь.
  const rounded = Math.round(height)
  if (Math.abs(rounded - lastHeight) > 2) {
    lastHeight = rounded
    root.style.setProperty('--app-height', `${rounded}px`)
  }

  // Пометка «клавиатура открыта» на <html> — для CSS-хуков (скрыть нижнюю навигацию).
  const layoutHeight = root.clientHeight
  if (layoutHeight - height > KEYBOARD_THRESHOLD) root.setAttribute('data-kb', 'open')
  else root.removeAttribute('data-kb')
}

function onFrame() {
  applyHeight()
  pinScroll()
}

/** Однократная установка слушателей. Безопасно вызывать повторно. */
export function setupViewport() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const vv = window.visualViewport
  if (vv) {
    // resize — клавиатура/поворот; scroll — iOS «подтаскивает» поле (тут и держим пин).
    vv.addEventListener('resize', onFrame)
    vv.addEventListener('scroll', pinScroll)
  }
  window.addEventListener('resize', onFrame)
  window.addEventListener('orientationchange', onFrame)

  // Любой скролл документа (iOS scroll-to-field при фокусе) — синхронно в ноль.
  // Синхронно и без rAF/таймаута: иначе слой успевает уехать вверх (эффект «мячика»).
  window.addEventListener('scroll', pinScroll, { passive: true })
  document.addEventListener('scroll', pinScroll, { passive: true })

  applyHeight()
}
