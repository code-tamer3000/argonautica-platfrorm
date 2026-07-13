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
// Максимальная виденная высота visual viewport (высота БЕЗ клавиатуры). От неё, а не
// от root.clientHeight, считаем «насколько сжало» — единственная кросс-платформенная
// опора. На Android layout viewport (innerHeight/root.clientHeight) сам сжимается под
// клавиатуру, поэтому сравнение с ним всегда давало ≈0 и data-kb НЕ ставился → нижний
// таб-бар оставался поверх композера и прятал нижние строки длинного сообщения.
let maxHeight = 0

/** Синхронно вернуть окно/документ к нулевому скроллу — гасим нативный «scroll to field». */
function pinScroll() {
  // window и scrollingElement оба могут «уехать» на iOS — сбрасываем оба.
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0)
  const se = document.scrollingElement
  if (se && se.scrollTop !== 0) se.scrollTop = 0
  if (document.body.scrollTop !== 0) document.body.scrollTop = 0
}

/**
 * iOS при фокусе на поле «подскроллливает» его в видимость, двигая scrollTop даже у
 * контейнеров с overflow:hidden (шапка приложения/чата уезжает вверх, хотя эти блоки
 * скроллиться не должны). Ловим scroll в ФАЗЕ ЗАХВАТА (scroll не всплывает) и, если
 * уехал именно клиппинг-контейнер (overflow: hidden/clip/visible — т.е. НЕ легитимный
 * скроллер), синхронно возвращаем его в ноль. Настоящие панели (.messages,
 * overflow:auto/scroll) не трогаем — они скроллятся как надо.
 *
 * ВАЖНО: решение принимаем ПООСЕВО. Раньше сброс завязывался только на overflow-y,
 * поэтому горизонтальный скроллер (нижний таб-бар: overflow-x:auto + overflow-y:hidden)
 * считался «клиппингом» и его scrollLeft гвоздями возвращался в ноль — панель разделов
 * на мобиле залипала и отпрыгивала назад при свайпе вбок. Теперь ось X трогаем, только
 * если по X реально нет скролла, а ось Y — только если нет скролла по Y.
 */
function isScroller(overflow: string) {
  return overflow === 'auto' || overflow === 'scroll'
}
function resetIfClipping(el: HTMLElement) {
  if (el.scrollTop === 0 && el.scrollLeft === 0) return
  const cs = getComputedStyle(el)
  // Клиппинг-контейнер уехал по вине iOS — гвоздями обратно, но только по той оси,
  // по которой элемент НЕ является легитимным скроллером.
  if (el.scrollTop !== 0 && !isScroller(cs.overflowY)) el.scrollTop = 0
  if (el.scrollLeft !== 0 && !isScroller(cs.overflowX)) el.scrollLeft = 0
}

function onAnyScroll(e: Event) {
  const el = e.target
  // Скролл документа/окна — общий сброс; иначе смотрим на конкретный элемент.
  if (!(el instanceof HTMLElement)) {
    pinScroll()
    return
  }
  resetIfClipping(el)
}

/**
 * После фокуса на поле iOS может «подскроллить» клиппинг-предков БЕЗ scroll-события —
 * проходим по цепочке предков поля и обнуляем всё, что уехало (шапки), плюс окно.
 * Несколько раз (rAF/таймауты): iOS двигает не сразу, а по ходу анимации клавиатуры.
 */
function unscrollAncestors(start: HTMLElement | null) {
  pinScroll()
  let el: HTMLElement | null = start
  while (el) {
    resetIfClipping(el)
    el = el.parentElement
  }
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

  // Растим «эталон без клавиатуры» вверх (поворот/ресайз окна расширяют вьюпорт), но
  // клавиатура его НЕ уменьшает — иначе сжатая высота стала бы новым эталоном и порог
  // никогда бы не сработал.
  if (rounded > maxHeight) maxHeight = rounded

  // Пометка «клавиатура открыта» на <html> — для CSS-хуков (скрыть нижнюю навигацию,
  // снять её резерв, прижать композер к клавиатуре). Сравниваем с maxHeight (высота без
  // клавиатуры), а НЕ с root.clientHeight: на Android layout viewport сам сжимается под
  // клавиатуру, и разница с ним всегда ≈0 — флаг не ставился, таб-бар прятал композер.
  if (maxHeight - rounded > KEYBOARD_THRESHOLD) root.setAttribute('data-kb', 'open')
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
  // Поворот меняет высоту вьюпорта без клавиатуры — сбрасываем эталон, чтобы он
  // переучился под новую ориентацию (иначе портретная высота осталась бы порогом
  // в ландшафте и data-kb ложно «залипал» бы открытым).
  window.addEventListener('orientationchange', () => { maxHeight = 0; onFrame() })

  // Любой скролл документа (iOS scroll-to-field при фокусе) — синхронно в ноль.
  // Синхронно и без rAF/таймаута: иначе слой успевает уехать вверх (эффект «мячика»).
  window.addEventListener('scroll', pinScroll, { passive: true })
  // Capture-фаза: scroll НЕ всплывает, но виден на захвате — так ловим и вложенные
  // клиппинг-контейнеры (шапки), которые iOS уводит вверх под фокус-поле.
  document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true })

  // Фокус на поле — момент, когда iOS начинает двигать предков (иногда без scroll-события).
  // Обнуляем цепочку предков несколько раз по ходу выезда клавиатуры.
  document.addEventListener('focusin', (e) => {
    const t = e.target
    if (!(t instanceof HTMLElement) || !t.matches('input, textarea, [contenteditable]')) return
    const reset = () => unscrollAncestors(t)
    reset()
    requestAnimationFrame(reset)
    setTimeout(reset, 100)
    setTimeout(reset, 300)
  })

  applyHeight()
}
