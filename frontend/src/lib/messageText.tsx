import { Fragment, type ReactNode } from 'react'

// Текст сообщения чата рендерим как ПРОСТОЙ текст — без markdown. Markdown-оформление
// (жирный/заголовки/списки) нужно только в базе знаний; в чате его никто не набирает,
// а звёздочки/решётки в обычном тексте не должны «съедаться» рендером. Здесь только то,
// что в чате реально нужно: сохранённые переносы строк, кликабельные ссылки и подсветка
// @упоминаний. Возвращаем React-узлы (не HTML) — dangerouslySetInnerHTML не нужен, XSS нет.
//
// @упоминание кликабельно, только если ник резолвится в id по карте mentionUsers
// (текущий ростер платформы) — переход ведёт на профиль в «Аргонавтах»
// (/argonauts/:userId). Нерезолвящийся ник (опечатка, ушедший пользователь) остаётся
// просто подсветкой без ссылки — как деградируют ссылки/пути выше при невалидном URL.

// «Голый» URL: http(s):// до первого пробела. Внутренний путь: /раздел без хоста
// (например /kb, /support) — контент (см. provision_second_intake.py) не знает
// домен окружения (стейдж/прод разные), поэтому ссылки на свои же разделы пишутся
// относительными путями. [текст](/путь) — то же самое, но с осмысленной подписью
// вместо голого пути (не полный markdown — только эта одна конструкция, скобки в
// обычном тексте никто не набирает). @упоминание: @ + латиница/цифры/_ (как ник в
// Telegram). Один общий проход, чтобы токены не пересекались.
const LINK_TEXT_RE = /\[([^\]\n]+)\]\((\/[a-zA-Z][\w/-]*)\)/
const URL_RE = /https?:\/\/[^\s]+/
const INTERNAL_PATH_RE = /(?<![\w/])\/[a-zA-Z][\w/-]*/
const MENTION_RE = /@[A-Za-z0-9_]{1,32}/
const TOKEN_RE = new RegExp(
  `${LINK_TEXT_RE.source}|(${URL_RE.source})|(${INTERNAL_PATH_RE.source})|(${MENTION_RE.source})`,
  'g',
)

function trimTrailingPunct(url: string): { url: string; trailing: string } {
  const m = url.match(/[.,!?;:)\]]+$/)
  if (!m) return { url, trailing: '' }
  const trailing = m[0]
  return { url: url.slice(0, url.length - trailing.length), trailing }
}

function tokenize(
  text: string,
  keyPrefix: string,
  mentionClass?: string,
  navigate?: (path: string) => void,
  mentionUsers?: Map<string, number>,
): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    if (match[1] !== undefined) {
      // [текст](/путь) — подписанная внутренняя ссылка.
      const label = match[1]
      const path = match[2]
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
    } else if (match[3]) {
      // Абсолютный URL. Ссылка на этот же домен (например, на статью БЗ или задание)
      // открывается внутри приложения — иначе в установленном PWA клик выкидывает в
      // системный браузер вместо перехода на нужный экран.
      const { url, trailing } = trimTrailingPunct(match[3])
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
    } else if (match[4]) {
      // Голый внутренний путь (/kb, /support, ...) — всегда открывается внутри
      // приложения, домен окружения ему для этого не нужен.
      const { url: path, trailing } = trimTrailingPunct(match[4])
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
      // @упоминание: если ник резолвится в id — кликабельный переход на профиль
      // в «Аргонавтах», иначе просто подсветка.
      const handle = match[5]
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
 * @упоминания подсвечены (класс передаёт вызывающий, т.к. стили — в CSS-модуле чата).
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
