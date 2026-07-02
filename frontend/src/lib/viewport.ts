/*
 * Стабилизация мобильного вьюпорта под экранную клавиатуру.
 *
 * Проблема: на мобиле layout viewport (100%/100vh) не сжимается при открытии
 * клавиатуры — сжимается только visual viewport. Из-за этого браузер сам
 * прокручивает страницу (window/documentElement), чтобы показать фокус-поле, и
 * весь макет «прыгает»: топбар уезжает, composer скачет, а поле ввода «улетает
 * вверх в космос», потому что фикс-оболочка (#root/body) сдвигается вместе со
 * скроллом layout viewport.
 *
 * Решение:
 *  1) держим высоту приложения равной visualViewport.height (CSS-переменная
 *     --app-height) и помечаем состояние «клавиатура открыта» на <html>;
 *  2) ПРИНУДИТЕЛЬНО держим скролл окна в нуле — не даём браузеру утащить
 *     фикс-оболочку наверх при фокусе на поле. Наш layout сам держит composer/поля
 *     видимыми (flex-колонка + #root = visual height), нативный скролл не нужен.
 */

// Порог (px), выше которого сжатие visual viewport считаем открытой клавиатурой.
const KEYBOARD_THRESHOLD = 120

let installed = false
let kbOpen = false

/** Вернуть окно/документ в нулевой скролл — гасим нативный «scroll into view». */
function pinScroll() {
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
  const se = document.scrollingElement
  if (se && se.scrollTop !== 0) se.scrollTop = 0
}

function apply() {
  const vv = window.visualViewport
  const height = vv ? vv.height : window.innerHeight
  const root = document.documentElement

  root.style.setProperty('--app-height', `${Math.round(height)}px`)

  // clientHeight = layout viewport (на iOS не сжимается клавиатурой);
  // если visual viewport заметно меньше — клавиатура открыта.
  const layoutHeight = root.clientHeight
  kbOpen = layoutHeight - height > KEYBOARD_THRESHOLD
  if (kbOpen) {
    root.setAttribute('data-kb', 'open')
    // При открытой клавиатуре браузер норовит проскроллить окно к полю — отменяем.
    pinScroll()
  } else {
    root.removeAttribute('data-kb')
  }
}

/** Однократная установка слушателей. Безопасно вызывать повторно. */
export function setupViewport() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
  }
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)

  // Фокус на поле = момент, когда iOS пытается «подскроллить» к нему и уносит
  // фикс-оболочку. Возвращаем скролл в ноль сразу и на следующем кадре (после
  // нативного скролла браузера).
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target as HTMLElement | null
      if (!t || !t.matches('input, textarea, [contenteditable]')) return
      pinScroll()
      requestAnimationFrame(pinScroll)
      setTimeout(pinScroll, 300)
    },
    true,
  )
  // Любой паразитный скролл окна при открытой клавиатуре — сбрасываем.
  window.addEventListener('scroll', () => { if (kbOpen) pinScroll() }, { passive: true })

  apply()
}
