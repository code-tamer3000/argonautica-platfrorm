import { Fragment, type ReactNode } from 'react'

// Текст сообщения чата рендерим как ПРОСТОЙ текст — без markdown. Markdown-оформление
// (жирный/заголовки/списки) нужно только в базе знаний; в чате его никто не набирает,
// а звёздочки/решётки в обычном тексте не должны «съедаться» рендером. Здесь только две
// вещи, которые в чате реально нужны: сохранённые переносы строк и кликабельные ссылки.
// Возвращаем React-узлы (не HTML) — никакого dangerouslySetInnerHTML, XSS невозможен.

// «Голый» URL: http(s):// до первого пробела. Хвостовую пунктуацию (.,!?)… и парную
// скобку) отрезаем — они почти всегда часть предложения, а не адреса.
const URL_RE = /(https?:\/\/[^\s]+)/g

function trimTrailingPunct(url: string): { url: string; trailing: string } {
  const m = url.match(/[.,!?;:)\]]+$/)
  if (!m) return { url, trailing: '' }
  const trailing = m[0]
  return { url: url.slice(0, url.length - trailing.length), trailing }
}

function linkify(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    if (start > last) out.push(text.slice(last, start))
    const { url, trailing } = trimTrailingPunct(match[0])
    out.push(
      <a key={`${keyPrefix}-l${i++}`} href={url} target="_blank" rel="noopener noreferrer nofollow">
        {url}
      </a>,
    )
    if (trailing) out.push(trailing)
    last = start + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Текст сообщения → React-узлы: переносы строк сохранены, «голые» ссылки кликабельны. */
export function renderMessageText(text: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {linkify(line, `${i}`)}
    </Fragment>
  ))
}
