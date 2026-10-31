import type { Band, Meta, Outlook, RankingConfig, ScoredSubzone, SubzoneProps, Weights } from '../types'

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

const BAND_ORDER: Record<Band, number> = { High: 0, Elevated: 1, Low: 2 }

/** Used only if the published data predates the ranking config. */
const OLD_RANKING: RankingConfig = { cluster_scaling: 'percentile', override_km: 1, override_cases: null, priority_risk_exponent: 1, priority_population_exponent: 1, sort: 'priority' }

/** Python's round() and this agree except on exact ties, which do not change any order that matters. */
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp

/**
 * Recompute risk, bands, priority and rank from the stored 0 to 1 components and override flag.
 * Mirrors score_subzones() in scripts/build_scores.py: keep the two in step.
 */
export function rescore(
  all: SubzoneProps[],
  weights: Weights,
  outlook: Outlook,
  bands: Meta['scoring']['bands'],
  ranking: RankingConfig = OLD_RANKING,
): Map<string, ScoredSubzone> {
  const w = normalise(weights)
  const eligible = all.filter((p) => p.eligible)
  const rows = eligible.map((props) => {
    const risk = round(w.spread * (props.spread ?? 0) + w.rain * (props.rain ?? 0) + w.temp * (props.temp ?? 0), 4)
    const priority = round(risk ** ranking.priority_risk_exponent * Math.max(0, props.vulnerable) ** ranking.priority_population_exponent, 2)
    return { props, risk, priority, override: Boolean(props.cluster_override) }
  })
  const n = rows.length
  const nHigh = Math.round(bands[outlook].high * n)
  const nElevated = Math.round(bands[outlook].elevated * n)
  const byRisk = [...rows].sort((a, b) => b.risk - a.risk || byId(a.props, b.props))
  const overrides = byRisk.filter((r) => r.override)
  const nHighRest = Math.max(0, nHigh - overrides.length)
  const band = new Map<string, Band>()
  overrides.forEach((r) => band.set(r.props.subzone_id, 'High'))
  byRisk.filter((r) => !r.override).forEach((r, i) => band.set(r.props.subzone_id, i < nHighRest ? 'High' : i < nHighRest + nElevated ? 'Elevated' : 'Low'))
  const bandRank = (id: string) => (ranking.sort === 'band_first' ? BAND_ORDER[band.get(id)!] : 0)
  const out = new Map<string, ScoredSubzone>()
  ;[...rows]
    .sort((a, b) => Number(b.override) - Number(a.override) || bandRank(a.props.subzone_id) - bandRank(b.props.subzone_id) || b.priority - a.priority || byId(a.props, b.props))
    .forEach((r, i) => out.set(r.props.subzone_id, { props: r.props, risk: r.risk, priority: r.priority, band: band.get(r.props.subzone_id)!, rank: i + 1 }))
  return out
}
