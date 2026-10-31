import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, DemoBadge, Status } from '../components/ui'
import { PREMISES_TYPE, type VisitsState } from '../copilot'
import { apiGet } from '../lib/api'
import { titleCase, weekLabel } from '../lib/format'

const TEAM_KEY = 'dengueradar-team'

/** Step 2 entry: an inspector picks their team and day and sees today's visits in order. */
export default function Inspect() {
  const [state, setState] = useState<VisitsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<string>(() => { try { return localStorage.getItem(TEAM_KEY) ?? '' } catch { return '' } })
  const [day, setDay] = useState(1)
  useEffect(() => { apiGet<VisitsState>('inspect').then(setState).catch((e: Error) => setError(e.message)) }, [])

  const teams = useMemo(() => [...new Set(state?.visits.map((v) => v.team_name) ?? [])], [state])
  const current = teams.includes(team) ? team : teams[0] ?? ''
  const days = useMemo(() => [...new Set(state?.visits.filter((v) => v.team_name === current).map((v) => v.day) ?? [])], [state, current])
  const visits = state?.visits.filter((v) => v.team_name === current && v.day === day) ?? []
  const pickTeam = (t: string) => { setTeam(t); setDay(1); try { localStorage.setItem(TEAM_KEY, t) } catch { /* optional */ } }

  if (!state) return <Status loading={!error} error={error} />
  if (!state.plan)
    return (
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Step 2 · Inspect</p>
        <h1 className="text-xl font-semibold text-ink">No plan for {weekLabel(state.epi_week)} yet</h1>
        <p className="mt-2 text-sm text-ink-2">Visits appear here once this week’s plan has been drafted.</p>
        <Link to="/" className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Go to Plan</Link>
      </Card>
    )

  const done = state.visits.filter((v) => v.report_id).length
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Step 2 · Inspect</p>
        <h1 className="text-xl font-semibold text-ink">Visits · {weekLabel(state.epi_week)}</h1>
        <p className="mt-1 text-xs text-ink-2">{state.plan.confirmed ? `Your confirmed plan v${state.plan.version}` : <>Using the current draft plan (v{state.plan.version}). <Link to="/" className="text-accent underline">Review or confirm it</Link></>} · {done} of {state.visits.length} reports filed this week</p>
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Team">
            {teams.map((t) => (
              <button key={t} onClick={() => pickTeam(t)} aria-pressed={t === current}
                className={`rounded-full border px-3 py-1.5 text-sm ${t === current ? 'border-accent bg-accent text-white' : 'border-line text-ink-2'}`}>{t}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Day">
            {days.map((d) => (
              <button key={d} onClick={() => setDay(d)} aria-pressed={d === day}
                className={`rounded-md border px-3 py-1 text-sm ${d === day ? 'border-accent text-accent' : 'border-line text-ink-2'}`}>Day {d}</button>
            ))}
          </div>
        </div>
      </Card>
      <ol className="space-y-2">
        {visits.map((v) => (
          <li key={v.premises_id}>
            <Link to={`/inspect/${v.premises_id}?team=${encodeURIComponent(v.team_name)}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm hover:border-accent">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-sm font-semibold tabular-nums text-ink-2">{v.visit_order}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{v.name}</span>
                <span className="block text-xs text-ink-2">{PREMISES_TYPE[v.premises_type] ?? v.premises_type} · {titleCase(v.subzone)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
                {v.report_id ? (
                  <span className="rounded-full border border-line px-2 py-0.5 text-ink">{v.breeding_found ? '▲ Breeding found' : '✓ Report filed'}</span>
                ) : (
                  <span className="text-ink-3">Not yet visited</span>
                )}
                {v.breeding_last_8_weeks >= 2 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-ink">Repeat site</span>}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <DemoBadge>Premises and past inspections are demo data</DemoBadge>
    </div>
  )
}
