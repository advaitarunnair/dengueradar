/**
 * Read-only access to DengueRadar's real published data (written daily by scripts/build_scores.py).
 * Every number the agent uses comes from here.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const WEB_DATA = join(process.cwd(), 'web', 'public', 'data')
const HISTORY = join(process.cwd(), 'data', 'history')

export interface AreaProps {
  subzone_id: string; subzone: string; planning_area: string; region: string
  residents: number; age65plus: number; under15: number; vulnerable: number; eligible: boolean
  spread: number | null; rain: number | null; temp: number | null
  rain_mm: number; temp_c: number; rain_mm_station: string; temp_c_station: string
  clusters_within_1km: number; cluster_cases_within_1km: number; nearest_cluster_km: number | null
  risk: number | null; priority: number | null; band: 'High' | 'Elevated' | 'Low' | null
  risk_rank: number | null; rank: number | null; rank_change: number | null; is_new_in_top20: boolean; reason: string
}
export interface Area extends AreaProps { lat: number; lon: number }

export interface Meta {
  generated_at: string; epi_week: string; current_cases: number; case_week: string
  forecast_cases: number; forecast_week: string; pct_change: number; outlook: 'Rising' | 'Stable' | 'Falling'
  drivers: { label: string; text: string; direction: string }[]
  active_clusters: number; cluster_cases: number
  clusters: { source_name: string; source_url: string; updated_at: string | null }
  scoring: { weights: Record<string, number>; bands: Record<string, { high: number; elevated: number }> }
}

type Ring = number[][]
function centroid(geom: { type: string; coordinates: unknown }): [number, number] {
  // Area-weighted centroid of the largest outer ring (good enough to locate a subzone).
  const polys = (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates) as Ring[][]
  let best: Ring = polys[0][0]
  let bestArea = 0
  for (const p of polys) {
    const ring = p[0]
    let a = 0
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = ring }
  }
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < best.length - 1; i++) {
    const f = best[i][0] * best[i + 1][1] - best[i + 1][0] * best[i][1]
    a += f; cx += (best[i][0] + best[i + 1][0]) * f; cy += (best[i][1] + best[i + 1][1]) * f
  }
  return [cy / (3 * a), cx / (3 * a)] // [lat, lon]
}

let cache: { areas: Area[]; meta: Meta } | null = null
export function load() {
  if (cache) return cache
  const scores = JSON.parse(readFileSync(join(WEB_DATA, 'scores.geojson'), 'utf8'))
  const areas: Area[] = scores.features.map((f: { properties: AreaProps; geometry: { type: string; coordinates: unknown } }) => {
    const [lat, lon] = centroid(f.geometry)
    return { ...f.properties, lat: +lat.toFixed(5), lon: +lon.toFixed(5) }
  })
  const meta = JSON.parse(readFileSync(join(WEB_DATA, 'meta.json'), 'utf8')) as Meta
  cache = { areas, meta }
  return cache
}

export function modelEval() {
  return JSON.parse(readFileSync(join(WEB_DATA, 'model_eval.json'), 'utf8'))
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Find an area by subzone id or (fuzzy) name. */
export function findArea(query: string): Area | undefined {
  const { areas } = load()
  const q = norm(query)
  return areas.find((a) => a.subzone_id === query) ??
    areas.find((a) => norm(a.subzone) === q) ??
    areas.find((a) => norm(a.subzone).includes(q) || q.includes(norm(a.subzone)))
}

export function rankedAreas(): Area[] {
  return load().areas.filter((a) => a.eligible && a.rank !== null).sort((a, b) => a.rank! - b.rank!)
}

export interface Snapshot { epi_week: string; outlook: string; subzones: Record<string, { rank: number; band: string; risk: number; priority: number }> }
export function snapshots(): Snapshot[] {
  try {
    return readdirSync(HISTORY).filter((f) => f.endsWith('.json')).sort()
      .map((f) => JSON.parse(readFileSync(join(HISTORY, f), 'utf8')) as Snapshot)
  } catch {
    return []
  }
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}
