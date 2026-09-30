import { useEffect, useState } from 'react'

export interface Async<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** fetch on mount / when deps change */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): Async<T> {
  const [state, setState] = useState<Async<T>>({ data: null, error: null, loading: true })
  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true, error: null }))
    fn()
      .then(data => alive && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

const COLOR_TOKENS = ['--s1', '--s2', '--s3', '--s-neutral', '--accent', '--pos', '--neg',
  '--ink', '--ink-2', '--muted', '--rule', '--grid', '--surface',
  '--seq-0', '--seq-1', '--seq-2', '--seq-3'] as const
export type Colors = Record<(typeof COLOR_TOKENS)[number], string>

function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries(COLOR_TOKENS.map(t => [t, cs.getPropertyValue(t).trim()])) as Colors
}

/** chart colors from the CSS tokens; updates when the OS theme changes */
export function useColors(): Colors {
  const [colors, setColors] = useState<Colors>(readColors)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setColors(readColors())
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return colors
}
