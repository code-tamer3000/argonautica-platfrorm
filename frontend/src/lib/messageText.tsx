import { Fragment, type ReactNode } from 'react'

// Текст сообщения чата рендерим как ПРОСТОЙ текст — без полного markdown. Markdown-оформление
// (заголовки/списки/код) нужно только в базе знаний и каналах-дневниках; в личке/группах/новостях
// решётки и списки в обычном тексте не должны «съедаться» рендером. Здесь то, что в чате реально
// нужно: сохранённые переносы строк, кликабельные ссылки, подсветка @упоминаний — и три инлайновых
// начертания (жирный/курсив/подчёркнутый), которые участник ставит кнопками панели форматирования
// (см. useTextFormatting.tsx), а не набирает вручную. Возвращаем React-узлы (не HTML) —
// dangerouslySetInnerHTML не нужен, XSS нет.

// Начертания: маркер не переносится через перевод строки, сразу внутри маркера — не пробел
// (иначе пустое выделение вида "* *" не считается курсивом). У курсива дополнительно запрещены
// соседние словесные символы и `*` — без этого "2*2*2", "a*b*c" читались бы как курсив, а
// "**жирный**" — как два курсива подряд. Подчёркивания в markdown нет — берём `++text++`
// (не конфликтует ни с обычным текстом, ни с markdown, где `__x__` — это жирный).
const BOLD_RE = /\*\*(?!\s)(?<bold>[^\n]+?)(?<!\s)\*\*/
const UNDERLINE_RE = /\+\+(?!\s)(?<underline>[^\n]+?)(?<!\s)\+\+/
const ITALIC_RE = /(?<![\w*])\*(?!\s)(?<italic>[^*\n]+?)(?<!\s)\*(?![\w*])/

// «Голый» URL: http(s):// до первого пробела. Внутренний путь: /раздел без хоста
// (например /kb, /support) — контент (см. provision_second_intake.py) не знает
// домен окружения (стейдж/прод разные), поэтому ссылки на свои же разделы пишутся
// относительными путями. [текст](/путь) — то же самое, но с осмысленной подписью
// вместо голого пути (не полный markdown — только эта одна конструкция, скобки в
// обычном тексте никто не набирает). @упоминание: @ + латиница/цифры/_ (как ник в
// Telegram). Один общий проход, чтобы токены не пересекались.
const LINK_TEXT_RE = /\[(?<linkLabel>[^\]\n]+)\]\((?<linkPath>\/[a-zA-Z][\w/-]*)\)/
const URL_RE = /(?<url>https?:\/\/[^\s]+)/
const INTERNAL_PATH_RE = /(?<![\w/])(?<path>\/[a-zA-Z][\w/-]*)/
const MENTION_RE = /(?<mention>@[A-Za-z0-9_]{1,32})/
const TOKEN_RE = new RegExp(
  [
    BOLD_RE.source,
    UNDERLINE_RE.source,
    ITALIC_RE.source,
    LINK_TEXT_RE.source,
    URL_RE.source,
    INTERNAL_PATH_RE.source,
    MENTION_RE.source,
  ].join('|'),
  'g',
)

// Те же три начертания, но как обычные (не именованные, с флагом g) регэкспы — для
// stripInlineMarks(), которая снимает маркеры для превью (колокольчик/пуш/закреп), не трогая
// остальной текст. Источники совпадают с BOLD_RE/UNDERLINE_RE/ITALIC_RE намеренно.
const BOLD_STRIP_RE = /\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g
const UNDERLINE_STRIP_RE = /\+\+(?!\s)([^\n]+?)(?<!\s)\+\+/g
const ITALIC_STRIP_RE = /(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g

/** Снимает маркеры начертаний (**/++/*), оставляя обычный текст — для превью. */
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

function trimTrailingPunct(url: string): { url: string; trailing: string } {
  const m = url.match(/[.,!?;:)\]]+$/)
  if (!m) return { url, trailing: '' }
  const trailing = m[0]
  return { url: url.slice(0, url.length - trailing.length), trailing }
}

// Начертания могут быть вложены (жирный с курсивом внутри), но не бесконечно — глубже этого
// парсер оставляет текст как есть (не пытается разобрать маркеры внутри маркеров).
const MAX_MARK_DEPTH = 3

function tokenize(
  text: string,
  keyPrefix: string,
  mentionClass?: string,
  navigate?: (path: string) => void,
  depth = 0,
): ReactNode[] {
  if (depth > MAX_MARK_DEPTH) return [text]
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const g = match.groups!
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    if (g.bold !== undefined) {
      out.push(
        <strong key={`${keyPrefix}-b${i++}`}>
          {tokenize(g.bold, `${keyPrefix}b${i}`, mentionClass, navigate, depth + 1)}
        </strong>,
      )
    } else if (g.underline !== undefined) {
      out.push(
        <u key={`${keyPrefix}-u${i++}`}>
          {tokenize(g.underline, `${keyPrefix}u${i}`, mentionClass, navigate, depth + 1)}
        </u>,
      )
    } else if (g.italic !== undefined) {
      out.push(
        <em key={`${keyPrefix}-i${i++}`}>
          {tokenize(g.italic, `${keyPrefix}i${i}`, mentionClass, navigate, depth + 1)}
        </em>,
      )
    } else if (g.linkLabel !== undefined) {
      // [текст](/путь) — подписанная внутренняя ссылка.
      const label = g.linkLabel
      const path = g.linkPath
      out.push(
        navigate ? (
          <a
            key={`${keyPrefix}-p${i++}`}
            href={path}
            onClick={(e) => {
              e.preventDefault()
              navigate(path)
            }}
          >
            {label}
          </a>
        ) : (
          <span key={`${keyPrefix}-p${i++}`}>{label}</span>
        ),
      )
    } else if (g.url !== undefined) {
      // Абсолютный URL. Ссылка на этот же домен (например, на статью БЗ или задание)
      // открывается внутри приложения — иначе в установленном PWA клик выкидывает в
      // системный браузер вместо перехода на нужный экран.
      const { url, trailing } = trimTrailingPunct(g.url)
      let internalPath: string | null = null
      try {
        const parsed = new URL(url, window.location.origin)
        if (parsed.origin === window.location.origin) {
          internalPath = `${parsed.pathname}${parsed.search}${parsed.hash}`
        }
      } catch {
        // не абсолютный/невалидный URL — оставляем внешней ссылкой ниже
      }
      out.push(
        internalPath && navigate ? (
          <a
            key={`${keyPrefix}-l${i++}`}
            href={internalPath}
            onClick={(e) => {
              e.preventDefault()
              navigate(internalPath!)
            }}
          >
            {url}
          </a>
        ) : (
          <a key={`${keyPrefix}-l${i++}`} href={url} target="_blank" rel="noopener noreferrer nofollow">
            {url}
          </a>
        ),
      )
      if (trailing) out.push(trailing)
    } else if (g.path !== undefined) {
      // Голый внутренний путь (/kb, /support, ...) — всегда открывается внутри
      // приложения, домен окружения ему для этого не нужен.
      const { url: path, trailing } = trimTrailingPunct(g.path)
      out.push(
        navigate ? (
          <a
            key={`${keyPrefix}-p${i++}`}
            href={path}
            onClick={(e) => {
              e.preventDefault()
              navigate(path)
            }}
          >
            {path}
          </a>
        ) : (
          <span key={`${keyPrefix}-p${i++}`}>{path}</span>
        ),
      )
      if (trailing) out.push(trailing)
    } else {
      // @упоминание — только подсветка (клик-переход на профиль пока не делаем).
      out.push(
        <span key={`${keyPrefix}-m${i++}`} className={mentionClass}>
          {g.mention}
        </span>,
      )
    }
    last = start + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Текст сообщения → React-узлы: переносы строк сохранены, «голые» ссылки кликабельны,
 * @упоминания подсвечены (класс передаёт вызывающий, т.к. стили — в CSS-модуле чата),
 * жирный/курсив/подчёркнутый (**/*/++) отрисованы как обычное inline-начертание.
 */
export function renderMessageText(
  text: string,
  mentionClass?: string,
  navigate?: (path: string) => void,
): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {tokenize(line, `${i}`, mentionClass, navigate)}
    </Fragment>
  ))
}
