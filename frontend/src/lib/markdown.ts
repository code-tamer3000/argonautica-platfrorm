// Рендер markdown в безопасный HTML. Используется для текста сообщений в
// каналах-дневниках («Дневник» / «Личный дневник»), где участники ведут
// ежедневные записи с оформлением (заголовки, списки, жирный). В личных чатах,
// группах и новостях текст рендерится как простой (см. lib/messageText.tsx).
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Все внешние ссылки — в новой вкладке и с rel=noopener (безопасность/UX).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
  }
})

marked.setOptions({
  gfm: true,       // автоссылки на «голые» URL, таблицы, ~~strike~~
  breaks: true,    // одиночный перенос строки → <br> (привычно для чата)
})

/** markdown → санированный HTML для dangerouslySetInnerHTML. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text) as string)
}
