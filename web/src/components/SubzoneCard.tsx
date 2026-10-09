import { num, titleCase } from '../lib/format'
import type { ScoredSubzone, SubzoneProps } from '../types'
import { BandBadge, Card, RankChange } from './ui'

function Bar({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  const pct = Math.round((value ?? 0) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-2">
        <span>{label}</span>
        <span className="tabular-nums">{detail}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-line" role="img" aria-label={`${label}: percentile ${pct}`}>
        <div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

interface Props {
  props: SubzoneProps | null
  scored: ScoredSubzone | undefined
  showChange: boolean
  onClose: () => void
}

export default function SubzoneCard({ props, scored, showChange, onClose }: Props) {
  if (!props)
    return (
      <Card title="Subzone details" className="h-full">
        <p className="text-sm text-ink-2">Click a subzone on the map, or a row in the inspection list, to see why it is ranked where it is.</p>
      </Card>
    )
  return (
    <Card
      className="h-full"
      title={titleCase(props.subzone)}
      action={<button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-accent-soft" aria-label="Close subzone details">✕ Close</button>}
    >
      <p className="-mt-2 text-sm text-ink-2">{titleCase(props.planning_area)} · {titleCase(props.region)}</p>
      {scored ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <BandBadge band={scored.band} />
            <span className="text-sm text-ink">Rank <strong>{scored.rank}</strong></span>
            {showChange && <span className="text-sm"><RankChange change={props.rank_change} /></span>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-ink-3">Risk score (0 to 1)</dt><dd className="text-lg font-semibold tabular-nums">{scored.risk.toFixed(2)}</dd></div>
            <div><dt className="text-xs text-ink-3">Seniors and children</dt><dd className="text-lg font-semibold tabular-nums">{num(props.vulnerable)}</dd></div>
          </dl>
          <p className="mt-1 text-xs text-ink-2">{num(props.age65plus)} aged 65+, {num(props.under15)} under 15, of {num(props.residents)} residents</p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-3">Why</p>
          <p className="text-sm text-ink">{props.reason}</p>
          <div className="mt-3 space-y-2">
            <Bar label="Cluster proximity" value={props.spread} detail={props.nearest_cluster_km === null ? 'no clusters' : `nearest ${props.nearest_cluster_km.toFixed(1)} km`} />
            <Bar label="Rainfall 2 to 8 weeks ago" value={props.rain} detail={`${num(Math.round(props.rain_mm))} mm`} />
            <Bar label="Temperature, last 4 weeks" value={props.temp} detail={`${props.temp_c.toFixed(1)} °C`} />
          </div>
          <p className="mt-2 text-xs text-ink-3">Bars show the percentile among ranked subzones. Weather from {props.rain_mm_station} (rain) and {props.temp_c_station} (temperature).</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-2">Not ranked: fewer than 100 residents ({num(props.residents)}).</p>
      )}
    </Card>
  )
}
