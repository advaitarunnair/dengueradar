import { useEffect, useState } from 'react'

export interface Loaded<T> {
  data: T | null
  error: string | null
  loading: boolean
}

/** Fetch a JSON file from public/data with loading and error state. */
export function useData<T>(file: string): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    fetch(`${import.meta.env.BASE_URL}data/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
        return r.json() as Promise<T>
      })
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((e: Error) => !cancelled && setState({ data: null, error: e.message, loading: false }))
    return () => {
      cancelled = true
    }
  }, [file])
  return state
}
