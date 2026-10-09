import { useState } from 'react'
import { refreshData } from '../lib/data'

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string }

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })

/** Loads the newest published data without reloading the page. */
export default function RefreshButton({ current }: { current: string | undefined }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const run = async () => {
    setState({ kind: 'busy' })
    try {
      const latest = await refreshData()
      const newer = !current || new Date(latest).getTime() > new Date(current).getTime()
      setState({ kind: 'done', text: newer ? `✓ Loaded newer data (${stamp(latest)} SGT)` : `✓ Already the latest (${stamp(latest)} SGT)` })
    } catch (e) {
      setState({ kind: 'error', text: `⚠ Could not refresh: ${(e as Error).message}` })
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        onClick={run}
        disabled={state.kind === 'busy'}
        title="Load the newest published clusters, weather, forecast and ranking"
        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:text-ink-3"
      >
        <span aria-hidden>↻</span> {state.kind === 'busy' ? 'Refreshing…' : 'Refresh data'}
      </button>
      {(state.kind === 'done' || state.kind === 'error') && <span role="status" className="text-xs text-ink-2">{state.text}</span>}
    </span>
  )
}
