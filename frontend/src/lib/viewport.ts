/*
 * Стабилизация мобильного вьюпорта под экранную клавиатуру.
 *
 * Проблема: на мобиле layout viewport (100%/100vh) не сжимается при открытии
 * клавиатуры — сжимается только visual viewport. Из-за этого браузер сам
 * прокручивает страницу, чтобы показать фокус-поле, и весь макет «прыгает»:
 * топбар уезжает, composer скачет.
 *
 * Решение: держим высоту приложения равной visualViewport.height (CSS-переменная
 * --app-height) и помечаем состояние «клавиатура открыта» на <html>, чтобы CSS мог
 * убрать нижний таб-бар и его резерв под клавиатурой.
 */

// Порог (px), выше которого сжатие visual viewport считаем открытой клавиатурой.
const KEYBOARD_THRESHOLD = 120

let installed = false

function apply() {
  const vv = window.visualViewport
  const height = vv ? vv.height : window.innerHeight
  const root = document.documentElement

  root.style.setProperty('--app-height', `${Math.round(height)}px`)

  // clientHeight = layout viewport (на iOS не сжимается клавиатурой);
  // если visual viewport заметно меньше — клавиатура открыта.
  const layoutHeight = root.clientHeight
  const keyboardOpen = layoutHeight - height > KEYBOARD_THRESHOLD
  if (keyboardOpen) root.setAttribute('data-kb', 'open')
  else root.removeAttribute('data-kb')
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
  apply()
}
