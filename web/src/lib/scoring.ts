import type { Band, Meta, Outlook, ScoredSubzone, SubzoneProps, Weights } from '../types'

export function normalise(w: Weights): Weights {
  const total = w.spread + w.rain + w.temp
  if (total <= 0) return { spread: 1 / 3, rain: 1 / 3, temp: 1 / 3 }
  return { spread: w.spread / total, rain: w.rain / total, temp: w.temp / total }
}

export function sameWeights(a: Weights, b: Weights): boolean {
  const x = normalise(a)
  const y = normalise(b)
  return (['spread', 'rain', 'temp'] as const).every((k) => Math.abs(x[k] - y[k]) < 0.005)
}

const byId = (a: SubzoneProps, b: SubzoneProps) => (a.subzone_id < b.subzone_id ? -1 : 1)

/**
 * Recompute risk, bands and priority from the stored percentile components.
 * Mirrors score_subzones() in scripts/build_scores.py.
 */
export function rescore(
  all: SubzoneProps[],
  weights: Weights,
  outlook: Outlook,
  bands: Meta['scoring']['bands'],
): Map<string, ScoredSubzone> {
  const w = normalise(weights)
  const eligible = all.filter((p) => p.eligible)
  const rows = eligible.map((props) => {
    const risk = Math.round((w.spread * (props.spread ?? 0) + w.rain * (props.rain ?? 0) + w.temp * (props.temp ?? 0)) * 1e4) / 1e4
    return { props, risk, priority: Math.round(risk * props.vulnerable * 10) / 10 }
  })
  const n = rows.length
  const nHigh = Math.round(bands[outlook].high * n)
  const nElevated = Math.round(bands[outlook].elevated * n)
  const band = new Map<string, Band>()
  ;[...rows]
    .sort((a, b) => b.risk - a.risk || byId(a.props, b.props))
    .forEach((r, i) => band.set(r.props.subzone_id, i < nHigh ? 'High' : i < nHigh + nElevated ? 'Elevated' : 'Low'))
  const out = new Map<string, ScoredSubzone>()
  ;[...rows]
    .sort((a, b) => b.priority - a.priority || byId(a.props, b.props))
    .forEach((r, i) => out.set(r.props.subzone_id, { ...r, band: band.get(r.props.subzone_id)!, rank: i + 1 }))
  return out
}
