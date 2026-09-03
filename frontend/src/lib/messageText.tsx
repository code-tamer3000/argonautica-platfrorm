import { Fragment, type ReactNode } from 'react'
import { BOLD_RE, ITALIC_RE, UNDERLINE_RE } from './inlineMarks'

// Текст сообщения чата рендерим как ПРОСТОЙ текст — без полного markdown. Markdown-оформление
// (заголовки/списки/код) нужно только в базе знаний и каналах-дневниках; в личке/группах/новостях
// решётки и списки в обычном тексте не должны «съедаться» рендером. Здесь то, что в чате реально
// нужно: сохранённые переносы строк, кликабельные ссылки, подсветка @упоминаний — и три инлайновых
// начертания (жирный/курсив/подчёркнутый), которые участник ставит панелью форматирования
// composer'а (см. useRichFormatting.ts) — сам composer WYSIWYG (contentEditable), маркеры
// (**, *, ++) появляются только на выходе, в отправленном content. Возвращаем React-узлы (не
// HTML) — dangerouslySetInnerHTML не нужен, XSS нет.
//
// @упоминание кликабельно, только если ник резолвится в id по карте mentionUsers
// (текущий ростер платформы) — переход ведёт на профиль в «Аргонавтах»
// (/argonauts/:userId). Нерезолвящийся ник (опечатка, ушедший пользователь) остаётся
// просто подсветкой без ссылки — как деградируют ссылки/пути выше при невалидном URL.
//
// BOLD_RE/UNDERLINE_RE/ITALIC_RE и stripInlineMarks — общие с lib/inlineMarks.ts
// (сериализация contentEditable в композере использует те же паттерны).
export { stripInlineMarks } from './inlineMarks'

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
  mentionUsers?: Map<string, number>,
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
          {tokenize(g.bold, `${keyPrefix}b${i}`, mentionClass, navigate, mentionUsers, depth + 1)}
        </strong>,
      )
    } else if (g.underline !== undefined) {
      out.push(
        <u key={`${keyPrefix}-u${i++}`}>
          {tokenize(g.underline, `${keyPrefix}u${i}`, mentionClass, navigate, mentionUsers, depth + 1)}
        </u>,
      )
    } else if (g.italic !== undefined) {
      out.push(
        <em key={`${keyPrefix}-i${i++}`}>
          {tokenize(g.italic, `${keyPrefix}i${i}`, mentionClass, navigate, mentionUsers, depth + 1)}
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
      // @упоминание: если ник резолвится в id по карте mentionUsers (текущий ростер
      // платформы) — кликабельный переход на профиль в «Аргонавтах», иначе просто подсветка.
      const handle = g.mention
      const userId = mentionUsers?.get(handle.slice(1).toLowerCase())
      out.push(
        userId !== undefined && navigate ? (
          <a
            key={`${keyPrefix}-m${i++}`}
            href={`/argonauts/${userId}`}
            className={mentionClass}
            onClick={(e) => {
              e.preventDefault()
              navigate(`/argonauts/${userId}`)
            }}
          >
            {handle}
          </a>
        ) : (
          <span key={`${keyPrefix}-m${i++}`} className={mentionClass}>
            {handle}
          </span>
        ),
      )
    }
    last = start + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Текст сообщения → React-узлы: переносы строк сохранены, «голые» ссылки кликабельны,
 * @упоминания подсвечены и (если ник резолвится) кликабельны на профиль (класс передаёт
 * вызывающий, т.к. стили — в CSS-модуле чата), жирный/курсив/подчёркнутый (**, *, ++)
 * отрисованы как обычное inline-начертание.
 */
export function renderMessageText(
  text: string,
  mentionClass?: string,
  navigate?: (path: string) => void,
  mentionUsers?: Map<string, number>,
): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {tokenize(line, `${i}`, mentionClass, navigate, mentionUsers)}
    </Fragment>
  ))
}
