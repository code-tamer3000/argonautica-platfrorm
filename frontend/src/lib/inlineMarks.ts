// Три инлайновых начертания (жирный/курсив/подчёркнутый), общие для:
//  - lib/messageText.tsx — рендер готового сообщения (маркеры → React-узлы),
//  - lib/markdown.ts — рендер в каналах-дневниках (маркеры уже понимает marked,
//    кроме подчёркивания — там отдельное inline-расширение с тем же синтаксисом),
//  - features/chat/useRichFormatting.tsx — панель форматирования композера
//    (execCommand напрямую, эти функции ей не нужны),
//  - features/chat/Composer.tsx — markerTextToHtml/htmlToMarkerText: сериализация
//    contentEditable-композера ⇄ маркерный текст (черновик/отправка).
//
// Маркер не переносится через перевод строки, сразу внутри маркера — не пробел (иначе
// пустое выделение вида "* *" не считается курсивом). У курсива дополнительно запрещены
// соседние словесные символы и `*` — без этого "2*2*2", "a*b*c" читались бы как курсив, а
// "**жирный**" — как два курсива подряд. Подчёркивания в markdown нет — берём `++text++`
// (не конфликтует ни с обычным текстом, ни с markdown, где `__x__` — это жирный).
export const BOLD_RE = /\*\*(?!\s)(?<bold>[^\n]+?)(?<!\s)\*\*/
export const UNDERLINE_RE = /\+\+(?!\s)(?<underline>[^\n]+?)(?<!\s)\+\+/
export const ITALIC_RE = /(?<![\w*])\*(?!\s)(?<italic>[^*\n]+?)(?<!\s)\*(?![\w*])/

// Только три начертания, без ссылок/упоминаний/URL — используется для сериализации
// contentEditable-композера, где пользователь ссылок не набирает (см. richText.ts), и
// для stripInlineMarks (превью, где ссылки уже не нужны как ссылки).
export const INLINE_MARK_RE = new RegExp(
  [BOLD_RE.source, UNDERLINE_RE.source, ITALIC_RE.source].join('|'),
  'g',
)

// Те же три начертания, но как обычные (не именованные, с флагом g) регэкспы — для
// stripInlineMarks(), которая снимает маркеры для превью (колокольчик/пуш/закреп), не трогая
// остальной текст. Источники совпадают с BOLD_RE/UNDERLINE_RE/ITALIC_RE намеренно.
const BOLD_STRIP_RE = /\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g
const UNDERLINE_STRIP_RE = /\+\+(?!\s)([^\n]+?)(?<!\s)\+\+/g
const ITALIC_STRIP_RE = /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g

/** Снимает маркеры начертаний (**, ++, *), оставляя обычный текст — для превью. */
export function stripInlineMarks(text: string): string {
  let result = text
  for (let i = 0; i < 3; i++) {
    const next = result
      .replace(BOLD_STRIP_RE, '$1')
      .replace(UNDERLINE_STRIP_RE, '$1')
      .replace(ITALIC_STRIP_RE, '$1')
    if (next === result) break
    result = next
  }
  return result
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Вложенность начертаний ограничена той же глубиной, что и рендер готового сообщения
// (lib/messageText.tsx) — глубже парсер оставляет текст как есть.
const MAX_MARK_DEPTH = 3

function inlineToHtml(text: string, depth = 0): string {
  if (depth > MAX_MARK_DEPTH) return escapeHtml(text)
  let out = ''
  let last = 0
  for (const match of text.matchAll(INLINE_MARK_RE)) {
    const g = match.groups!
    const start = match.index ?? 0
    if (start > last) out += escapeHtml(text.slice(last, start))
    if (g.bold !== undefined) out += `<b>${inlineToHtml(g.bold, depth + 1)}</b>`
    else if (g.underline !== undefined) out += `<u>${inlineToHtml(g.underline, depth + 1)}</u>`
    else if (g.italic !== undefined) out += `<i>${inlineToHtml(g.italic, depth + 1)}</i>`
    last = start + match[0].length
  }
  if (last < text.length) out += escapeHtml(text.slice(last))
  return out
}

/**
 * Маркерный текст (**bold**, *italic*, ++underline++) → HTML для innerHTML
 * contentEditable-поля композера — обратная операция к htmlToMarkerText. Используется при
 * восстановлении черновика/заряженного текста, где текст приходит как обычная строка.
 */
export function markerTextToHtml(text: string): string {
  return text.split('\n').map((line) => inlineToHtml(line)).join('<br>')
}

const TAG_MARKS: Record<string, { open: string; close: string }> = {
  B: { open: '**', close: '**' },
  STRONG: { open: '**', close: '**' },
  I: { open: '*', close: '*' },
  EM: { open: '*', close: '*' },
  U: { open: '++', close: '++' },
}

// execCommand('styleWithCSS', false, 'false') (см. useRichFormatting.tsx) должен заставлять
// браузер оборачивать выделение тегом (<b>/<i>/<u>), но это исторически непортируемое
// поведение между движками — если браузер всё же выдал <span style="font-weight:...">,
// распознаём и инлайновый стиль, а не только имя тега. Без этого текст визуально жирный
// прямо в composer'е, но после сериализации в content уходит обычным — маркер никто не
// поставил, потому что тег был не B/STRONG.
function elementMarks(el: HTMLElement): Array<{ open: string; close: string }> {
  const marks: Array<{ open: string; close: string }> = []
  const tagMark = TAG_MARKS[el.tagName]
  if (tagMark) marks.push(tagMark)
  const style = el.style
  if (style) {
    const bold = style.fontWeight === 'bold' || style.fontWeight === 'bolder' || Number(style.fontWeight) >= 600
    if (bold && el.tagName !== 'B' && el.tagName !== 'STRONG') marks.push(TAG_MARKS.B)
    if (style.fontStyle === 'italic' && el.tagName !== 'I' && el.tagName !== 'EM') marks.push(TAG_MARKS.I)
    const underline =
      style.textDecorationLine === 'underline' || style.textDecoration.split(' ').includes('underline')
    if (underline && el.tagName !== 'U') marks.push(TAG_MARKS.U)
  }
  return marks
}

function walkToMarkerText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  if (el.tagName === 'BR') return '\n'
  let inner = ''
  for (const child of Array.from(el.childNodes)) inner += walkToMarkerText(child)
  for (const mark of elementMarks(el)) inner = `${mark.open}${inner}${mark.close}`
  // execCommand/paste иногда заворачивают строки в <div>/<p> вместо <br> — считаем это
  // переводом строки, чтобы многострочный вставленный текст не склеился в одну строку.
  const isBlock = el.tagName === 'DIV' || el.tagName === 'P'
  return isBlock ? `${inner}\n` : inner
}

/**
 * contentEditable DOM → маркерный plain text (**bold**, *italic*, ++underline++) — то,
 * что реально уходит в `content` сообщения. Вызывается на каждый ввод в композере.
 */
export function htmlToMarkerText(root: HTMLElement): string {
  let out = ''
  for (const child of Array.from(root.childNodes)) out += walkToMarkerText(child)
  // Браузер при наборе подряд идущих пробелов в contentEditable иногда подставляет
  // неразрывный пробел (U+00A0), чтобы визуально не схлопывался — в сохранённом тексте
  // это должен быть обычный пробел.
  return out.replace(/\n$/, '').replace(/ /g, ' ')
}
