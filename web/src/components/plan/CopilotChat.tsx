import { useEffect, useRef, useState } from 'react'
import { describeTool, type PlanRecord, type PlanState } from '../../copilot'
import { apiStream } from '../../lib/api'
import { titleCase } from '../../lib/format'

interface Props { state: PlanState; onPlan: (r: PlanRecord) => void; onDone: () => void }

/** Officer <-> agent conversation about the plan: questions are answered (Super), changes trigger a re-plan (Ultra). */
export default function CopilotChat({ state, onPlan, onDone }: Props) {
  const record = state.record!
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<string[]>([])
  const [pending, setPending] = useState<{ role: string; content: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const locked = record.status === 'confirmed'
  const a = record.plan.areas
  const suggestions = [
    a.length > 2 ? `Why is ${titleCase(a[0].subzone)} above ${titleCase(a[2].subzone)}?` : 'Why is the top area first?',
    record.plan.constraints.teams.length > 2 ? `Only ${record.plan.constraints.teams.length - 1} teams this week` : 'Add a third team this week',
    'Skip areas inspected last week',
    `Each team can do ${record.plan.constraints.per_day + 2} premises a day`,
  ]

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [state.messages.length, pending.length, live.length])

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    setBusy(true)
    setError(null)
    setInput('')
    setPending([{ role: 'user', content: message }])
    setLive([])
    try {
      await apiStream('copilot', { message, plan_id: record.id }, (e) => {
        if (e.type === 'status') setLive((l) => [...l, String(e.text)])
        if (e.type === 'tool') setLive((l) => [...l, describeTool(String(e.name), String(e.args))])
        if (e.type === 'error') setError(String(e.error))
        if (e.type === 'reply' && e.record) onPlan(e.record as PlanRecord)
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
      setPending([])
      setLive([])
      onDone()
    }
  }

  const messages = [...state.messages, ...pending]
  return (
    <section className="no-print flex flex-col rounded-xl border border-line bg-white shadow-sm">
      <header className="border-b border-line px-4 py-3">
        <h2 className="font-semibold text-ink">Copilot</h2>
        <p className="text-xs text-ink-2">Ask why, or tell it your constraints. Questions: Nemotron Super. Re-plans: Nemotron Ultra.</p>
      </header>
      <div className="max-h-[360px] min-h-[120px] space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        {messages.length === 0 && <p className="text-ink-3">No messages yet this week.</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'ml-8 rounded-lg bg-accent-soft px-3 py-2 text-ink' : 'mr-4 text-ink'}>
            {m.role === 'assistant' && <span className="mr-1 text-xs font-semibold text-accent">Copilot</span>}
            <span className="whitespace-pre-wrap">{m.content}</span>
          </div>
        ))}
        {busy && (
          <ul className="space-y-1 text-xs text-ink-2">
            {live.map((l, i) => <li key={i}>{i === live.length - 1 ? '● ' : '✓ '}{l}</li>)}
            {live.length === 0 && <li>● Thinking…</li>}
          </ul>
        )}
        {error && <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-ink">⚠ {error}</p>}
        <div ref={end} />
      </div>
      {locked ? (
        <p className="border-t border-line px-4 py-3 text-xs text-ink-2">This plan is confirmed. Unconfirm it to ask for changes.</p>
      ) : (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)} disabled={busy}
                className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-accent hover:text-accent disabled:opacity-50">{s}</button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex gap-2">
            <label className="sr-only" htmlFor="copilot-input">Message the copilot</label>
            <input id="copilot-input" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} maxLength={600}
              placeholder="e.g. Team Bravo is short-staffed on Friday"
              className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm text-ink" />
            <button type="submit" disabled={busy || !input.trim()}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Send</button>
          </form>
        </div>
      )}
    </section>
  )
}
