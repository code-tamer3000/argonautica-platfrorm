import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import manifest from './manifest.json'

// The book "Ричард Радд — 64 пути" is bundled as per-chapter HTML fragments
// (built by scripts/build_genkeys_book.py). Like the key markdown, each fragment
// is loaded lazily via import.meta.glob so opening the reader pulls only the
// requested chapter, not ~900KB of prose at once.
const loaders = import.meta.glob('./*.html', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

function loaderFor(n: number): (() => Promise<string>) | undefined {
  const name = String(n).padStart(2, '0')
  return loaders[`./${name}.html`]
}

/** Chapter number → its title (from the build manifest), 1..64. */
export function chapterTitle(n: number): string {
  return (manifest.chapters as Record<string, string>)[String(n)] ?? ''
}

export const CHAPTER_COUNT = 64

type State = { html: string | null; loading: boolean; error: boolean }

/** Lazily load + sanitize a book chapter's HTML fragment (chapter N == key N). */
export function useBookChapter(n: number | null): State {
  const [state, setState] = useState<State>({ html: null, loading: false, error: false })

  useEffect(() => {
    if (n == null) {
      setState({ html: null, loading: false, error: false })
      return
    }
    const loader = loaderFor(n)
    if (!loader) {
      setState({ html: null, loading: false, error: true })
      return
    }
    let cancelled = false
    setState({ html: null, loading: true, error: false })
    loader()
      .then((raw) => {
        if (cancelled) return
        // Fragments are already HTML; sanitize before injecting.
        const html = DOMPurify.sanitize(raw)
        setState({ html, loading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ html: null, loading: false, error: true })
      })
    return () => {
      cancelled = true
    }
  }, [n])

  return state
}
