import { Fragment, type ReactNode } from 'react'

// Текст сообщения чата рендерим как ПРОСТОЙ текст — без markdown. Markdown-оформление
// (жирный/заголовки/списки) нужно только в базе знаний; в чате его никто не набирает,
// а звёздочки/решётки в обычном тексте не должны «съедаться» рендером. Здесь только то,
// что в чате реально нужно: сохранённые переносы строк, кликабельные ссылки и подсветка
// @упоминаний. Возвращаем React-узлы (не HTML) — dangerouslySetInnerHTML не нужен, XSS нет.

// «Голый» URL: http(s):// до первого пробела. @упоминание: @ + латиница/цифры/_
// (как ник в Telegram). Один общий проход, чтобы токены не пересекались.
const URL_RE = /https?:\/\/[^\s]+/
const MENTION_RE = /@[A-Za-z0-9_]{1,32}/
const TOKEN_RE = new RegExp(`(${URL_RE.source})|(${MENTION_RE.source})`, 'g')

function trimTrailingPunct(url: string): { url: string; trailing: string } {
  const m = url.match(/[.,!?;:)\]]+$/)
  if (!m) return { url, trailing: '' }
  const trailing = m[0]
  return { url: url.slice(0, url.length - trailing.length), trailing }
}

function tokenize(text: string, keyPrefix: string, mentionClass?: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    if (match[1]) {
      // URL
      const { url, trailing } = trimTrailingPunct(match[1])
      out.push(
        <a key={`${keyPrefix}-l${i++}`} href={url} target="_blank" rel="noopener noreferrer nofollow">
          {url}
        </a>,
      )
      if (trailing) out.push(trailing)
    } else {
      // @упоминание — только подсветка (клик-переход на профиль пока не делаем).
      out.push(
        <span key={`${keyPrefix}-m${i++}`} className={mentionClass}>
          {match[2]}
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
 * @упоминания подсвечены (класс передаёт вызывающий, т.к. стили — в CSS-модуле чата).
 */
export function renderMessageText(text: string, mentionClass?: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {tokenize(line, `${i}`, mentionClass)}
    </Fragment>
  ))
}
