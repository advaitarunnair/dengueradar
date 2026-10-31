/**
 * Pure planning logic, separate from the model calls so it can be tested without tokens:
 * rendering an area's reason from data keys, and fitting areas to team capacity.
 */
import { distanceKm, type Area } from './data.ts'
import type { Stop } from './routing.ts'

export const FACTOR_KEYS = ['large_cluster', 'cluster_within_1km', 'rainfall_2_8wk', 'temperature_4wk', 'seniors_children', 'rank_rising'] as const
export type FactorKey = (typeof FACTOR_KEYS)[number]

const num = (n: number) => n.toLocaleString('en-SG')

function factorText(a: Area, key: FactorKey): string | null {
  switch (key) {
    case 'large_cluster':
      return a.cluster_override ? `${num(a.max_cluster_cases_near ?? 0)}-case cluster within 1 km` : null
    case 'cluster_within_1km':
      if (a.clusters_within_1km > 0) return `${a.clusters_within_1km} active cluster${a.clusters_within_1km > 1 ? 's' : ''} within 1 km (${num(a.cluster_cases_within_1km)} cases)`
      return a.nearest_cluster_km !== null ? `nearest active cluster ${a.nearest_cluster_km} km away` : 'no active clusters'
    case 'rainfall_2_8wk':
      return `${num(Math.round(a.rain_mm))} mm of rain 2 to 8 weeks ago`
    case 'temperature_4wk':
      return `mean ${a.temp_c} °C over the last 4 weeks`
    case 'seniors_children':
      return `${num(a.vulnerable)} seniors and children`
    case 'rank_rising':
      return a.rank_change && a.rank_change > 0 ? `up ${a.rank_change} places since last week` : null
  }
}

const hasDigit = (s: string) => /\d/.test(s)

export interface RenderedReason { reason: string; focus: string; factors: FactorKey[]; corrections: { field: string; removed: string }[] }

/**
 * The model names data keys and writes number-free notes; every number here comes from the area's own data,
 * so numbers cannot be mixed up between areas. A note containing a digit is dropped and reported.
 */
export function renderReason(a: Area, factors: unknown, note: unknown, focus: unknown): RenderedReason {
  const asked = Array.isArray(factors) ? factors.filter((f): f is FactorKey => (FACTOR_KEYS as readonly string[]).includes(f)) : []
  const keys: FactorKey[] = [...new Set<FactorKey>([...(a.cluster_override ? ['large_cluster' as const] : []), ...(asked.length ? asked : ['cluster_within_1km', 'rainfall_2_8wk', 'seniors_children'] as const)])]
  const parts = keys.map((k) => factorText(a, k)).filter((x): x is string => Boolean(x))
  const facts = parts.join('; ')
  const corrections: RenderedReason['corrections'] = []
  const clean = (field: string, v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (s && hasDigit(s)) { corrections.push({ field, removed: s }); return '' }
    return s
  }
  const n = clean('note', note)
  const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.') : '')
  return { reason: [sentence(facts), sentence(n)].filter(Boolean).join(' '), focus: clean('focus', focus), factors: keys, corrections }
}

/** An area further than this from a team's other areas is not assigned to that team. */
export const MAX_DETOUR_KM = 8
/** A partial visit below this many premises is not worth the trip. */
const MIN_PARTIAL = 2

export interface Placement { subzone_id: string; team: string; stops: Stop[]; premises_total: number }
export interface Dropped { subzone_id: string; why: string }

/**
 * Fit areas, in priority order, to team capacity. The model's team is kept when it matches the team's home regions
 * and fits; otherwise the home team, otherwise the nearest team within MAX_DETOUR_KM. When an area does not fit in
 * full, it is covered partly, keeping the stops given first (premises with past breeding), rather than being cut.
 */
export function allocateTeams(
  chosen: { area: Area; team?: string; stops: Stop[] }[],
  teams: string[], teamCapacity: number, homes: Record<string, string[]>,
): { placements: Placement[]; dropped: Dropped[]; free: Record<string, number> } {
  const used: Record<string, number> = Object.fromEntries(teams.map((t) => [t, 0]))
  const placed: Record<string, { lat: number; lon: number }[]> = Object.fromEntries(teams.map((t) => [t, []]))
  const placements: Placement[] = []
  const dropped: Dropped[] = []
  const free = (t: string) => teamCapacity - used[t]
  for (const { area, team: proposed, stops } of chosen) {
    const n = stops.length
    const region = area.region.replace(' REGION', '')
    const isHome = (t: string) => (homes[t] ?? []).includes(region)
    const km = (t: string) => {
      const pts = placed[t]
      if (!pts.length) return Number.POSITIVE_INFINITY
      return distanceKm({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length }, area)
    }
    const nearby = (t: string) => km(t) <= MAX_DETOUR_KM || !placed[t].length
    const pick = (need: number) => {
      const fits = (t: string) => free(t) >= need
      if (proposed && teams.includes(proposed) && fits(proposed) && (isHome(proposed) || !(homes[proposed] ?? []).length)) return proposed
      return teams.filter((t) => isHome(t) && fits(t)).sort((x, y) => used[x] - used[y])[0]
        ?? teams.filter((t) => fits(t) && nearby(t)).sort((x, y) => km(x) - km(y) || used[x] - used[y])[0]
    }
    let team = pick(n)
    let take = n
    if (!team && n > MIN_PARTIAL) {
      const options = teams.filter((t) => free(t) >= MIN_PARTIAL && (isHome(t) || nearby(t))).sort((x, y) => Number(isHome(y)) - Number(isHome(x)) || free(y) - free(x))
      if (options[0]) { team = options[0]; take = Math.min(n, free(team)) }
    }
    if (!team) {
      const slots = teams.map((t) => `${t} ${free(t)} of ${teamCapacity} slots left`).join(', ')
      dropped.push({ subzone_id: area.subzone_id, why: teams.some((t) => free(t) >= n) ? `${n} premises would fit, but no team with room is within ${MAX_DETOUR_KM} km (${slots})` : `its ${n} premises did not fit (${slots})` })
      continue
    }
    used[team] += take
    placed[team].push(area)
    placements.push({ subzone_id: area.subzone_id, team, stops: stops.slice(0, take), premises_total: n })
  }
  return { placements, dropped, free: Object.fromEntries(teams.map((t) => [t, free(t)])) }
}

const REGION_NAMES: Record<string, string> = { WEST: 'West', CENTRAL: 'Central', NORTH: 'North', 'NORTH-EAST': 'North-East', EAST: 'East' }
export const regionLabel = (regions: string[]) => regions.map((r) => REGION_NAMES[r] ?? r).join(' + ')
export const weekName = (label: string) => `E-week ${Number(label.split('-W')[1])}`
