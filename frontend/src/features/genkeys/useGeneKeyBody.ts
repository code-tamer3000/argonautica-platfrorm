import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

// The 64 markdown bodies are bundled but loaded lazily: import.meta.glob with
// `query: '?raw'` gives us per-file dynamic importers, so the initial wheel
// render doesn't pull ~2MB of prose. Each file is fetched only when its key is
// opened, then cached by the module registry (repeat opens are instant).
const loaders = import.meta.glob('./content/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

function loaderFor(n: number): (() => Promise<string>) | undefined {
  const name = String(n).padStart(2, '0')
  return loaders[`./content/${name}.md`]
}

/** Strip the redundant "## Спектр" / "## Характеристики" heads from the body —
 *  the wheel + panel header already surface that; the reading is the prose. */
function forReading(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const h2 = /^##\s+(.*)/.exec(line)
    if (h2) {
      const head = h2[1].trim()
      skipping = head === 'Спектр' || head === 'Характеристики'
      if (skipping) continue
    } else if (line.startsWith('# ')) {
      // drop the top H1 (title is rendered in the panel header)
      continue
    }
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

type State = { html: string | null; loading: boolean; error: boolean }

/** Lazily load + render a Gene Key's full markdown body to sanitized HTML. */
export function useGeneKeyBody(n: number | null): State {
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
        const html = DOMPurify.sanitize(marked.parse(forReading(raw)) as string)
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
