import { dateLabel, downloadCsv, num, titleCase, weekLabel } from '../lib/format'
import type { Meta, ScoredSubzone } from '../types'
import { BandBadge, Card, Disclaimer, RankChange } from './ui'

interface Props {
  rows: ScoredSubzone[]
  capacity: number
  onCapacity: (n: number) => void
  selectedId: string | null
  onSelect: (id: string) => void
  meta: Meta
  customWeights: boolean
}

const clamp = (n: number) => Math.min(60, Math.max(5, Math.round(n) || 5))

export default function InspectionList({ rows, capacity, onCapacity, selectedId, onSelect, meta, customWeights }: Props) {
  const exportCsv = () =>
    downloadCsv(
      `dengueradar-inspection-list-${meta.epi_week}.csv`,
      ['rank', 'subzone', 'planning_area', 'band', 'risk', 'vulnerable_residents', 'new_in_top20', 'rank_change', 'reason'],
      rows.map((r) => [r.rank, titleCase(r.props.subzone), titleCase(r.props.planning_area), r.band, r.risk.toFixed(2), r.props.vulnerable,
        customWeights ? '' : r.props.is_new_in_top20 ? 'yes' : 'no', customWeights ? '' : (r.props.rank_change ?? ''), r.props.reason]),
    )
  const button = 'rounded-md border border-line px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft'
  return (
    <Card>
      <div className="print-only mb-3">
        <h1 className="text-xl font-bold">DengueRadar inspection list</h1>
        <p className="text-sm">{weekLabel(meta.epi_week)} · generated {dateLabel(meta.generated_at)} · top {rows.length} subzones by priority</p>
        <p className="text-sm">Outlook: {meta.outlook} ({meta.forecast_cases} cases per week forecast for {weekLabel(meta.forecast_week)}, {meta.current_cases} now){customWeights ? ' · custom weights' : ''}</p>
      </div>
      <div className="no-print mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Inspection list</h2>
          <p className="text-xs text-ink-2">Ranked by priority = risk score × residents aged 65+ or under 15.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-2">
            Team capacity (subzones this week)
            <span className="mt-1 flex items-center gap-2">
              <input type="range" min={5} max={60} value={capacity} onChange={(e) => onCapacity(clamp(Number(e.target.value)))} className="w-32 accent-accent" aria-label="Capacity slider" />
              <input type="number" min={5} max={60} value={capacity} onChange={(e) => onCapacity(clamp(Number(e.target.value)))} className="w-16 rounded-md border border-line px-2 py-1 text-sm text-ink" />
            </span>
          </label>
          <button onClick={exportCsv} className={button}>⬇ Download CSV</button>
          <button onClick={() => window.print()} className={button}>🖨 Print list</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
              <th className="py-2 pr-3 font-medium">Rank</th>
              <th className="py-2 pr-3 font-medium">Subzone</th>
              <th className="py-2 pr-3 font-medium">Planning area</th>
              <th className="py-2 pr-3 font-medium">Band</th>
              <th className="py-2 pr-3 font-medium">Reason</th>
              <th className="py-2 pr-3 text-right font-medium">Seniors and children</th>
              <th className="py-2 font-medium">Since last week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const selected = r.props.subzone_id === selectedId
              return (
                <tr
                  key={r.props.subzone_id}
                  onClick={() => onSelect(r.props.subzone_id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(r.props.subzone_id))}
                  tabIndex={0}
                  aria-selected={selected}
                  className={`cursor-pointer border-b border-line align-top hover:bg-accent-soft ${selected ? 'bg-accent-soft' : ''}`}
                >
                  <td className="py-2 pr-3 font-semibold tabular-nums">{r.rank}</td>
                  <td className="py-2 pr-3 font-medium text-ink">
                    {titleCase(r.props.subzone)}
                    {!customWeights && r.props.is_new_in_top20 && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">New</span>}
                  </td>
                  <td className="py-2 pr-3 text-ink-2">{titleCase(r.props.planning_area)}</td>
                  <td className="py-2 pr-3"><BandBadge band={r.band} /></td>
                  <td className="py-2 pr-3 text-xs text-ink-2">{r.props.reason}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{num(r.props.vulnerable)}</td>
                  <td className="py-2 text-xs">{customWeights ? <span className="text-ink-3">–</span> : <RankChange change={r.props.rank_change} />}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!customWeights && meta.previous_week === null && <p className="no-print mt-2 text-xs text-ink-3">Week-on-week changes appear from the second weekly run; this is the first snapshot.</p>}
      <Disclaimer className="print-only mt-4" />
    </Card>
  )
}
