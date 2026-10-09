import { useEffect, useState, useSyncExternalStore } from 'react'

export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
}

// A shared "data version". Bumping it makes every useData hook fetch its file again,
// bypassing the browser and CDN caches, so the Refresh button can pick up a newer weekly run.
let version = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const dataUrl = (file: string, bust: string | number) => `${import.meta.env.BASE_URL}data/${file}${bust ? `?v=${bust}` : ''}`

/** Fetch a JSON file from public/data with loading and error state. Keeps showing the old data while refreshing. */
export function useData<T>(file: string): Loaded<T> {
  const v = useSyncExternalStore(subscribe, () => version)
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    fetch(dataUrl(file, v), v ? { cache: 'no-store' } : undefined)
      .then((r) => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
        return r.json() as Promise<T>
      })
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e: Error) => !cancelled && setState((s) => ({ data: s.data, error: s.data ? null : e.message, loading: false })))
    return () => {
      cancelled = true
    }
  }, [file, v])
  return state
}

/**
 * Ask the server for the newest published data. Returns the generated_at of what is now published.
 * Every mounted useData hook re-fetches, so the whole page updates without a reload.
 */
export async function refreshData(): Promise<string> {
  const stamp = Date.now()
  const r = await fetch(dataUrl('meta.json', stamp), { cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const meta = (await r.json()) as { generated_at: string }
  version = stamp
  listeners.forEach((fn) => fn())
  return meta.generated_at
}
