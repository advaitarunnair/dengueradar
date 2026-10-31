import { num, titleCase } from '../../lib/format'
import type { Plan, PlanTeam } from '../../copilot'
import { teamColor } from '../../copilot'
import { BandBadge } from '../ui'

export default function TeamCard({ plan, team, onSelect, selectedId }: { plan: Plan; team: PlanTeam; onSelect: (id: string) => void; selectedId: string | null }) {
  const color = teamColor(plan, team.name)
  const areas = plan.areas.filter((a) => a.team === team.name)
  const pct = Math.min(100, Math.round((team.premises / team.capacity) * 100))
  const km = team.days.reduce((s, d) => s + d.km, 0)
  return (
    <section className="print-plain rounded-xl border border-line bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
          <h3 className="font-semibold text-ink">{team.name}</h3>
          <span className="text-xs text-ink-2">{team.regions.map(titleCase).join(' + ') || 'No areas'}</span>
        </div>
        <div className="min-w-40 text-right text-xs text-ink-2">
          <p><strong className="text-ink">{team.premises}</strong> of {team.capacity} premises · {team.days.length} days · {km.toFixed(1)} km between stops</p>
          <div className="mt-1 h-1.5 rounded-full bg-line" role="img" aria-label={`${pct}% of capacity used`}>
            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      </header>
      <ol className="divide-y divide-line">
        {areas.map((a) => (
          <li key={a.subzone_id}>
            <button
              onClick={() => onSelect(a.subzone_id)}
              className={`w-full px-4 py-3 text-left hover:bg-accent-soft ${selectedId === a.subzone_id ? 'bg-accent-soft' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="w-6 text-sm font-semibold tabular-nums text-ink-2">{a.order}.</span>
                <span className="font-medium text-ink">{titleCase(a.subzone)}</span>
                <span className="text-xs text-ink-3">{titleCase(a.planning_area)}</span>
                <BandBadge band={a.band} />
                <span className="text-xs text-ink-2">Rank {a.rank} · {a.premises_total && a.premises_total > a.premises ? `${a.premises} of ${a.premises_total} premises (partial)` : `${a.premises} premises`} · {num(a.vulnerable)} seniors and children</span>
              </div>
              <p className="mt-1 pl-8 text-sm text-ink">
                {a.reason}
              </p>
              {a.focus && <p className="mt-0.5 pl-8 text-xs text-ink-2"><span aria-hidden>🔎</span> {a.focus}</p>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
