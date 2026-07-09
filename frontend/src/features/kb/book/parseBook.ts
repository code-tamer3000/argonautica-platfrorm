import { marked } from 'marked'
import DOMPurify from 'dompurify'

export interface BookChapter {
  /** Chapter label for the TOC, e.g. "1-й генный ключ ПУТЬ СВЕЖЕСТИ". */
  title: string
  /** Short number/roman for the rail, derived from the title when present. */
  num: string
  /** Sanitized HTML of the chapter body (markdown → HTML). */
  html: string
  /** Slug used as the scroll anchor / deep-link fragment. */
  slug: string
}

export interface ParsedBook {
  /** Book title (the leading `# …`), or '' if absent. */
  title: string
  chapters: BookChapter[]
}

function slugify(s: string, i: number): string {
  const base = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base ? `${i + 1}-${base}` : `ch-${i + 1}`
}

/** Pull a compact chapter marker from a title: "12-й …" → "12", roman → itself. */
function chapterNum(title: string, fallback: number): string {
  const arabic = /^(\d+)\s*[-–—]?\s*(?:й|я|е|го)?\b/.exec(title)
  if (arabic) return arabic[1]
  const roman = /^([IVXLCDM]+)\.?\s/i.exec(title)
  if (roman) return roman[1].toUpperCase()
  return String(fallback + 1)
}

/**
 * Split a book's markdown `body` into chapters on its `##` headings. The leading
 * `# Title` (if any) becomes the book title; everything before the first `##`
 * (a preface) is folded into a synthetic first chapter so nothing is lost.
 */
export function parseBook(md: string): ParsedBook {
  const lines = md.replace(/\r\n/g, '\n').split('\n')

  let bookTitle = ''
  const sections: { title: string; body: string[] }[] = []
  let current: { title: string; body: string[] } | null = null

  for (const line of lines) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line)
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2) {
      if (current) sections.push(current)
      current = { title: h2[1], body: [] }
    } else if (h1 && !current && !bookTitle) {
      bookTitle = h1[1]
    } else if (current) {
      current.body.push(line)
    } else {
      // Preface text before the first ## — open an untitled section for it.
      current = { title: bookTitle || 'Начало', body: [line] }
    }
  }
  if (current) sections.push(current)

  const chapters: BookChapter[] = sections
    .map((s, i) => {
      const bodyMd = s.body.join('\n').trim()
      const html = DOMPurify.sanitize(marked.parse(bodyMd) as string)
      return {
        title: s.title,
        num: chapterNum(s.title, i),
        html,
        slug: slugify(s.title, i),
      }
    })
    // Drop a fully-empty leading section (e.g. body was only the # title).
    .filter((c, i) => c.html.trim() !== '' || i > 0)

  return { title: bookTitle, chapters }
}
