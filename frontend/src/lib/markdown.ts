// Рендер markdown в безопасный HTML. Используется для текста сообщений в
// каналах-дневниках («Дневник» / «Личный дневник»), где участники ведут
// ежедневные записи с оформлением (заголовки, списки, жирный/курсив/подчёркнутый).
// В личных чатах, группах и новостях текст рендерится как простой, с теми же тремя
// начертаниями через отдельный парсер (см. lib/messageText.tsx).
import { marked, type TokenizerAndRendererExtension } from 'marked'
import DOMPurify from 'dompurify'

// Все внешние ссылки — в новой вкладке и с rel=noopener (безопасность/UX).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

// Markdown не знает подчёркивания (`__x__` у marked — это тот же жирный, что и `**x**`).
// Добавляем `++x++` как inline-расширение — тот же синтаксис, что и в plain-режиме чата
// (lib/messageText.tsx), чтобы Ж/К/Ч из панели форматирования работали одинаково что в
// личке, что в дневнике. `<u>` сам по себе — в дефолтном allow-list DOMPurify.
const underlineExtension: TokenizerAndRendererExtension = {
  name: 'underline',
  level: 'inline',
  start(src) {
    return src.match(/\+\+(?!\s)/)?.index
  },
  tokenizer(src) {
    const match = /^\+\+(?!\s)([^\n]+?)(?<!\s)\+\+/.exec(src)
    if (!match) return undefined
    return {
      type: 'underline',
      raw: match[0],
      text: match[1],
      tokens: this.lexer.inlineTokens(match[1]),
    }
  },
  renderer(token) {
    return `<u>${this.parser.parseInline(token.tokens ?? [])}</u>`
  },
}

marked.use({
  gfm: true,       // автоссылки на «голые» URL, таблицы, ~~strike~~
  breaks: true,    // одиночный перенос строки → <br> (привычно для чата)
  extensions: [underlineExtension],
})

/** markdown → санированный HTML для dangerouslySetInnerHTML. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string)
}
