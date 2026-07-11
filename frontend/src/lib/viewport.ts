/*
 * Стабилизация мобильного вьюпорта под экранную клавиатуру.
 *
 * Проблема: на мобиле layout viewport (100vh) не сжимается при открытии клавиатуры —
 * сжимается только visual viewport. Из-за этого низ чата/композер прячется за
 * клавиатурой.
 *
 * Решение (простое и без петель обратной связи):
 *  - #root — position:fixed слой на всю ВИДИМУЮ область (см. global.css): top:0 +
 *    height = --app-height (= visualViewport.height). Окну нечего скроллить под
 *    фокус-поле → браузер не утаскивает шапку вверх.
 *  - Здесь только выставляем --app-height по visualViewport.height. Никакого
 *    pinScroll и слежки за offsetTop: и то, и другое во время анимации выезда
 *    клавиатуры даёт петлю (scroll → apply → scroll…) и шапка «скачет мячиком».
 *
 * offsetTop НЕ компенсируем намеренно: при overflow:hidden на html/body и фикс-слое
 * iOS держит visual viewport у верхней кромки (offsetTop≈0), а живое слежение за ним
 * во время анимации как раз и болтало шапку.
 */

// Порог (px), выше которого сжатие visual viewport считаем открытой клавиатурой.
const KEYBOARD_THRESHOLD = 120

let installed = false
let lastHeight = 0

function apply() {
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

  // Пометка «клавиатура открыта» на <html> — для CSS-хуков (напр. скрыть нижнюю
  // навигацию под клавиатурой). Считаем по разнице layout vs visual высоты.
  const layoutHeight = root.clientHeight
  if (layoutHeight - height > KEYBOARD_THRESHOLD) root.setAttribute('data-kb', 'open')
  else root.removeAttribute('data-kb')
}

/** Однократная установка слушателей. Безопасно вызывать повторно. */
export function setupViewport() {
  if (installed || typeof window === 'undefined') return
  installed = true

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', apply)
    // scroll visualViewport НЕ слушаем: он шлёт события во время анимации клавиатуры,
    // а реагировать на них (менять layout) — верный способ получить осцилляцию.
  }
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)

  apply()
}
