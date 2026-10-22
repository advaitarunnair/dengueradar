import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, DemoBadge, Status } from '../components/ui'
import { PREMISES_TYPE, type Briefing, type Offender, type ReviewState } from '../copilot'
import { apiGet, apiPost } from '../lib/api'
import { dateLabel, titleCase, weekLabel } from '../lib/format'

const LEVEL: Record<Offender['level'], { label: string; icon: string }> = {
  persistent: { label: 'Persistent (3+ weeks)', icon: '▲▲' },
  repeat: { label: 'Repeat (2 weeks)', icon: '▲' },
  multiple: { label: 'Multiple habitats in one visit', icon: '◆' },
}

function Tile({ label, value, compare }: { label: string; value: number; compare?: { value: number; week: string } }) {
  const diff = compare ? value - compare.value : 0
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <p className="text-xs text-ink-2">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-ink">{value.toLocaleString('en-SG')}</p>
      {compare && (
        <p className="text-xs text-ink-2">
          {diff === 0 ? 'Same as' : diff > 0 ? `▲ ${diff} more than` : `▼ ${-diff} fewer than`} {weekLabel(compare.week)} ({compare.value})
        </p>
      )}
    </div>
  )
}

/** Step 3: the supervisor's week in review. */
export default function Review() {
  const [week, setWeek] = useState<string | null>(null)
  const [weeks, setWeeks] = useState<string[]>([])
  const [data, setData] = useState<ReviewState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [brief, setBrief] = useState<Briefing | null>(null)
  const [briefBusy, setBriefBusy] = useState(false)
  const [flags, setFlags] = useState<Record<number, string> | null>(null)

  useEffect(() => {
    setData(null)
    apiGet<ReviewState>(`review${week ? `?week=${week}` : ''}`).then((d) => { setData(d); if (!week) setWeeks([d.stats.week, d.stats.previous_week]) }).catch((e: Error) => setError(e.message))
  }, [week])

  const loadBrief = useCallback(async (refresh = false) => {
    if (!data) return
    setBriefBusy(true)
    try { setBrief(await apiPost<Briefing>('review', { action: 'summary', week: data.stats.week, refresh })) }
    catch (e) { setError((e as Error).message) }
    finally { setBriefBusy(false) }
  }, [data])

  useEffect(() => {
    if (!data) return
    setBrief(null)
    loadBrief()
    apiPost<{ explanations: Record<number, string> }>('review', { action: 'flags', week: data.stats.week }).then((r) => setFlags(r.explanations)).catch(() => setFlags({}))
  }, [data, loadBrief])

  if (!data) return <Status loading={!error} error={error} />
  const s = data.stats
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Step 3 · Review</p>
            <h1 className="text-xl font-semibold text-ink">Week in review · {weekLabel(s.week)}</h1>
            <p className="mt-1 text-xs text-ink-2">Counts and flags are computed from saved reports; the briefing is written by Nemotron Super from those numbers only.</p>
          </div>
          <div className="flex gap-2" role="group" aria-label="Week">
            {weeks.map((w) => (
              <button key={w} onClick={() => setWeek(w)} aria-pressed={w === s.week}
                className={`rounded-md border px-3 py-1.5 text-sm ${w === s.week ? 'border-accent text-accent' : 'border-line text-ink-2'}`}>{weekLabel(w)}</button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Inspections" value={s.this_week.inspections} compare={{ value: s.last_week.inspections, week: s.previous_week }} />
          <Tile label="Premises with breeding" value={s.this_week.with_breeding} compare={{ value: s.last_week.with_breeding, week: s.previous_week }} />
          <Tile label="Overdue follow-ups (all weeks)" value={s.overdue_follow_ups.total} />
          <Tile label="Repeat-offender sites (8 weeks)" value={data.offenders_total} />
        </div>
        <div className="mt-3"><DemoBadge>Inspection records are demo data, plus any reports saved in this app</DemoBadge></div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card title="Supervisor briefing" action={
          <button onClick={() => loadBrief(true)} disabled={briefBusy} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:text-ink-3">
            ↻ {briefBusy ? 'Writing…' : 'Regenerate'}
          </button>}>
          {!brief && <p className="text-sm text-ink-2">{briefBusy ? 'Nemotron Super is writing the briefing…' : 'Loading…'}</p>}
          {brief && (
            <div className="space-y-3 text-sm">
              {brief.sections.map((sec) => (
                <section key={sec.title}>
                  <h3 className="font-semibold text-ink">{sec.title}</h3>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">{sec.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </section>
              ))}
              <p className="text-xs text-ink-3">
                Nemotron Super{brief.cached ? ' (cached)' : ''} · every number checked against the computed counts
                {brief.removed.length ? ` · ${brief.removed.length} point(s) with an unverifiable number removed` : ''}
              </p>
            </div>
          )}
        </Card>

        <Card title="Breeding habitats">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-ink-3"><th className="pb-1 font-medium">Habitat</th><th className="pb-1 text-right font-medium">{weekLabel(s.week)}</th><th className="pb-1 text-right font-medium">{weekLabel(s.previous_week)}</th></tr></thead>
            <tbody>
              {[...new Set([...s.breeding_habitats.this_week, ...s.breeding_habitats.last_week].map((h) => h.habitat))].map((h) => {
                const a = s.breeding_habitats.this_week.find((x) => x.habitat === h)?.breeding_sites ?? 0
                const b = s.breeding_habitats.last_week.find((x) => x.habitat === h)?.breeding_sites ?? 0
                return <tr key={h} className="border-t border-line"><td className="py-1.5 text-ink">{h}</td><td className="text-right tabular-nums">{a}</td><td className="text-right tabular-nums text-ink-2">{b}</td></tr>
              })}
            </tbody>
          </table>
          <h3 className="mt-4 text-sm font-semibold text-ink">By team this week</h3>
          <ul className="mt-1 space-y-0.5 text-sm text-ink">{s.teams.map((t) => <li key={t.team}>{t.team}: {t.inspections} inspections, {t.with_breeding} with breeding</li>)}</ul>
        </Card>
      </div>

      <Card title={`Repeat offenders · ${data.offenders_total} sites`}>
        <p className="-mt-1 mb-3 text-xs text-ink-2">Detected in SQL: breeding in 2 or more different weeks of the last 8, or 2 or more breeding habitats in one visit. Explanations by Nemotron Nano; escalation steps are fixed rules.</p>
        <ul className="divide-y divide-line">
          {data.offenders.slice(0, 12).map((o) => (
            <li key={o.premises_id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-line px-2 py-0.5 text-xs text-ink"><span aria-hidden>{LEVEL[o.level].icon}</span> {LEVEL[o.level].label}</span>
                <Link to={`/inspect/${o.premises_id}`} className="font-medium text-accent underline">{o.name}</Link>
                <span className="text-xs text-ink-2">{PREMISES_TYPE[o.premises_type] ?? o.premises_type} · {titleCase(o.subzone)}</span>
              </div>
              <p className="mt-1 text-sm text-ink">Breeding in {o.weeks_with_breeding} week{o.weeks_with_breeding === 1 ? '' : 's'} ({o.breeding_weeks.map((w) => w.replace('2026-', '')).join(', ')}); last on {dateLabel(o.last_breeding)}. Habitats: {o.habitats ?? 'n/a'}.</p>
              {flags?.[o.premises_id] && <p className="mt-0.5 text-sm text-ink-2">{flags[o.premises_id]}</p>}
              <p className="mt-0.5 text-xs font-medium text-ink">→ {o.escalation}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Re-inspect next · ${s.reinspect.length}`}>
          <ul className="space-y-1 text-sm">
            {s.reinspect.slice(0, 12).map((r) => <li key={r.id} className="text-ink">{r.name} <span className="text-ink-2">· due {r.due ? dateLabel(r.due) : 'not set'}{r.team_name ? ` · ${r.team_name}` : ''}</span></li>)}
          </ul>
        </Card>
        <Card title={`Overdue follow-ups · ${s.overdue_follow_ups.total}`}>
          <ul className="space-y-1 text-sm">
            {s.overdue_follow_ups.oldest.slice(0, 12).map((r) => <li key={r.id} className="text-ink">{r.name} <span className="text-ink-2">· {r.days_overdue} days overdue{r.team_name ? ` · ${r.team_name}` : ''}</span></li>)}
          </ul>
        </Card>
      </div>
    </div>
  )
}
