import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AgentTrace, { stepsFromToolCalls, type TraceStep } from '../components/plan/AgentTrace'
import CopilotChat from '../components/plan/CopilotChat'
import PlanMap from '../components/plan/PlanMap'
import TeamCard from '../components/plan/TeamCard'
import TrustStrip from '../components/plan/TrustStrip'
import { BandBadge, Card, DemoBadge, Status } from '../components/ui'
import { describeTool, type PlanRecord, type PlanState } from '../copilot'
import { apiGet, apiPost, apiStream } from '../lib/api'
import { useData } from '../lib/data'
import { dateLabel, titleCase, weekLabel } from '../lib/format'
import type { ScoresCollection } from '../types'

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })

export default function PlanPage() {
  const [state, setState] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const scores = useData<ScoresCollection>('scores.geojson')

  const reload = useCallback(() => apiGet<PlanState>('plan').then(setState).catch((e: Error) => setError(e.message)), [])
  useEffect(() => { reload() }, [reload])

  const generate = async () => {
    setRunning(true)
    setError(null)
    setSteps([{ kind: 'status', text: 'Starting the planning agent (Nemotron Ultra)' }])
    try {
      await apiStream('plan', { action: 'generate' }, (e) => {
        if (e.type === 'status') setSteps((s) => [...s, { kind: 'status', text: String(e.text) }])
        if (e.type === 'tool') setSteps((s) => [...s, { kind: 'tool', text: describeTool(String(e.name), String(e.args)) }])
        if (e.type === 'error') setError(String(e.error))
        if (e.type === 'plan') setState((st) => (st ? { ...st, record: e.record as PlanRecord } : st))
      })
      await reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const setConfirmed = async (on: boolean) => {
    if (!state?.record) return
    setError(null)
    try {
      setState(await apiPost<PlanState>('plan', { action: on ? 'confirm' : 'unconfirm', id: state.record.id }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!state) return <Status loading={!error} error={error} />
  const record = state.record
  const plan = record?.plan

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Step 1 · Plan</p>
            <h1 className="text-xl font-semibold text-ink">This week’s inspection plan · {weekLabel(state.epi_week)}</h1>
            {record && plan && (
              <p className="mt-1 text-xs text-ink-2">
                {record.status === 'confirmed' ? '✓ Confirmed' : 'Draft'} · version {record.version} · drafted by Nemotron Ultra
                {record.source === 'scheduled_job' ? ' in the scheduled weekly job' : ''} on {timeLabel(record.created_at)} ·{' '}
                {plan.agent.tool_calls.length} tool calls, {(plan.agent.ms / 1000).toFixed(0)} s
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {record?.status !== 'confirmed' && (
              <button onClick={generate} disabled={running}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft disabled:text-ink-3">
                <span aria-hidden>↻</span> {running ? 'Agent is planning…' : record ? 'Regenerate' : 'Generate this week’s plan'}
              </button>
            )}
            {record && !running && (
              <>
                <Link to={`/print/${record.id}`} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft">
                  <span aria-hidden>🖨</span> Team sheets
                </Link>
                {record.status === 'confirmed' ? (
                  <button onClick={() => setConfirmed(false)} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink-2 hover:bg-accent-soft">Unconfirm</button>
                ) : (
                  <button onClick={() => setConfirmed(true)} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">✓ Confirm and assign to teams</button>
                )}
              </>
            )}
          </div>
        </div>
        {error && <p role="alert" className="mt-3 rounded-md border border-line bg-accent-soft px-3 py-2 text-sm text-ink">⚠ {error}</p>}
        {running && (
          <div className="mt-4 rounded-lg border border-line bg-page p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Agent working</p>
            <AgentTrace steps={steps} running />
          </div>
        )}
        {plan && !running && (
          <div className="mt-4 space-y-3">
            {record?.status === 'confirmed' && (
              <p className="rounded-md border border-line bg-accent-soft px-3 py-2 text-sm text-ink">
                ✓ Confirmed {record.confirmed_at ? timeLabel(record.confirmed_at) : ''}. Visits are assigned to teams: inspectors see them in <Link to="/inspect" className="font-medium text-accent underline">Inspect</Link>.
              </p>
            )}
            {plan.changes && (plan.changes.added.length + plan.changes.removed.length + plan.changes.moved.length > 0) && (
              <div className="rounded-md border border-line px-3 py-2 text-sm">
                <p className="font-medium text-ink">What changed in version {record?.version}</p>
                <ul className="mt-1 space-y-0.5 text-ink-2">
                  {plan.changes.added.length > 0 && <li><span aria-hidden>＋</span> Added: {plan.changes.added.join(', ')}</li>}
                  {plan.changes.removed.length > 0 && <li><span aria-hidden>－</span> Removed: {plan.changes.removed.join(', ')}</li>}
                  {plan.changes.moved.map((m) => <li key={m.subzone}><span aria-hidden>⇄</span> {m.subzone}: {m.from} → {m.to}</li>)}
                </ul>
              </div>
            )}
            <p className="text-sm leading-relaxed text-ink">{plan.summary}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-line px-2.5 py-1 text-ink-2">
                Island-wide: {plan.outlook.current_cases} cases in {weekLabel(plan.outlook.case_week)}, forecast {plan.outlook.forecast_cases} for {weekLabel(plan.outlook.forecast_week)} · {plan.outlook.outlook}
              </span>
              {plan.checks.unsupported.length === 0 ? (
                <span className="rounded-full border border-line px-2.5 py-1 text-ink-2" title="Every number shown was checked against DengueRadar data; each area's reason only against that area's own data.">
                  ✓ All {plan.checks.numbers_checked} numbers checked against our data
                  {plan.checks.replaced?.length ? ` · ${plan.checks.replaced.length} reason(s) replaced with facts` : ''}
                  {plan.checks.removed_sentences?.length ? ` · ${plan.checks.removed_sentences.length} unverifiable sentence(s) removed` : ''}
                </span>
              ) : (
                <span className="rounded-full border border-line bg-accent-soft px-2.5 py-1 text-ink">
                  ⚠ {plan.checks.unsupported.length} number(s) not found in our data: {plan.checks.unsupported.join(', ')}. Check before use.
                </span>
              )}
              <DemoBadge>Premises are demo data</DemoBadge>
            </div>
          </div>
        )}
        {!plan && !running && (
          <p className="mt-4 text-sm text-ink-2">No plan yet for this week. Generate one: the agent reads this week’s real forecast, rankings and recent news, then drafts areas and team assignments for you to review.</p>
        )}
        <div className="mt-4"><TrustStrip /></div>
      </Card>

      {plan && !running && (
        <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            {plan.teams.map((t) => <TeamCard key={t.name} plan={plan} team={t} onSelect={setSelectedId} selectedId={selectedId} />)}
            {state.candidates.length > 0 && (
              <Card title="Just missed the cut">
                <ul className="flex flex-wrap gap-2 text-sm">
                  {state.candidates.map((c) => (
                    <li key={c.subzone_id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
                      <span className="text-ink-2">#{c.rank}</span> {titleCase(c.subzone)} <BandBadge band={c.band} />
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-2">Next in priority order but outside this week’s capacity or skipped by the agent.</p>
              </Card>
            )}
          </div>
          <div className="space-y-4">
            <CopilotChat state={state} onPlan={(r) => setState((st) => (st ? { ...st, record: r } : st))} onDone={reload} />
            <Card title="Plan map">
              {scores.data ? <PlanMap plan={plan} scores={scores.data} selectedId={selectedId} onSelect={setSelectedId} /> : <Status loading={!scores.error} error={scores.error} />}
              <p className="mt-2 text-xs text-ink-2">Shaded: planned subzones by team. Dots and lines: visiting order (nearest neighbour), solid and dashed lines alternate by day.</p>
            </Card>
            <Card title="Recent context">
              {plan.context.length ? (
                <ul className="space-y-2 text-sm">
                  {plan.context.map((c) => (
                    <li key={c.id}>
                      <a href={c.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">[{c.id}] {c.title}</a>
                      {c.published && <span className="text-xs text-ink-3"> · {dateLabel(c.published)}</span>}
                      <p className="text-xs text-ink-2">{c.note}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">The agent searched recent news (via Tavily) but found nothing Singapore-specific worth citing this week.</p>
              )}
            </Card>
            <Card title="How the agent built this plan">
              <AgentTrace steps={[...stepsFromToolCalls(plan.agent.tool_calls), { kind: 'status', text: `Decided areas and teams; code checked capacity, ordered visits and verified ${plan.checks.numbers_checked} numbers` }]} running={false} />
              {plan.checks.dropped.length > 0 && (
                <p className="mt-2 text-xs text-ink-2">Removed by checks: {plan.checks.dropped.map((d) => `${d.subzone_id.replace(/-/g, ' ')} (${d.why})`).join('; ')}.</p>
              )}
              <p className="mt-2 text-xs text-ink-3">{plan.agent.tokens.toLocaleString('en-SG')} tokens on Nebius Token Factory.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
