/**
 * The planning agent's tools. Each returns compact JSON built only from our real data
 * (rankings, history snapshots, clusters) plus clearly labelled demo inspection records.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { findArea, load, rankedAreas, snapshots, type Area } from './data.ts'
import { sql } from './db.ts'
import { searchRecentContext, type Source } from './tavily.ts'

export const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'rank_areas',
      description: 'List residential subzones in island-wide inspection order: large nearby clusters first, then band, then priority (risk squared x square root of seniors and children). Use first to see the candidates.',
      parameters: {
        type: 'object',
        properties: {
          region: { type: 'string', description: 'Optional region filter: CENTRAL, EAST, NORTH, NORTH-EAST or WEST' },
          top_n: { type: 'integer', description: 'How many to return (max 30)', default: 20 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_area_risk',
      description: "Full risk breakdown for one subzone: the rule-based risk index and its components, plus the island-wide forecast. The forecast is island-wide; there is no per-subzone forecast.",
      parameters: { type: 'object', properties: { area: { type: 'string', description: 'Subzone name or id' } }, required: ['area'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_area_history',
      description: 'Weekly rank and band history for one subzone, plus recent inspection records there (demo data) including breeding found and open follow-ups.',
      parameters: { type: 'object', properties: { area: { type: 'string', description: 'Subzone name or id' } }, required: ['area'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_recent_context',
      description: 'Search recent news and official sources for Singapore dengue clusters, outbreaks or weather alerts. Returns sources with ids (S1, S2...) to cite.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
]

const pick = (a: Area) => ({
  subzone_id: a.subzone_id, subzone: a.subzone, planning_area: a.planning_area, region: a.region.replace(' REGION', ''),
  rank: a.rank, band: a.band, risk: a.risk, large_cluster_override: Boolean(a.cluster_override), seniors_and_children: a.vulnerable,
  clusters_within_1km: a.clusters_within_1km, cluster_cases_within_1km: a.cluster_cases_within_1km,
  nearest_cluster_km: a.nearest_cluster_km, rainfall_mm_2_to_8_weeks_ago: a.rain_mm, rank_change_vs_last_week: a.rank_change,
})

async function premisesCounts(ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {}
  const rows = (await sql()`select subzone_id, count(*)::int as n from premises where subzone_id = any(${ids}) group by 1`) as { subzone_id: string; n: number }[]
  return Object.fromEntries(rows.map((r) => [r.subzone_id, r.n]))
}

/** Executes tool calls; collects every Tavily source so the UI can cite them. */
export class ToolRunner {
  sources: (Source & { id: string })[] = []

  async run(name: string, rawArgs: string): Promise<unknown> {
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(rawArgs || '{}') } catch { return { error: 'Arguments were not valid JSON' } }
    switch (name) {
      case 'rank_areas': {
        const region = typeof args.region === 'string' ? args.region.toUpperCase().replace(' REGION', '') : null
        const n = Math.min(30, Math.max(1, Number(args.top_n) || 20))
        const list = rankedAreas().filter((a) => !region || a.region.replace(' REGION', '') === region).slice(0, n)
        const counts = await premisesCounts(list.map((a) => a.subzone_id))
        return { areas: list.map((a) => ({ ...pick(a), demo_premises: counts[a.subzone_id] ?? 0 })) }
      }
      case 'get_area_risk': {
        const a = findArea(String(args.area ?? ''))
        if (!a) return { error: `No subzone matches "${args.area}"` }
        const { meta } = load()
        return {
          ...pick(a), residents: a.residents, aged_65_plus: a.age65plus, under_15: a.under15,
          component_percentiles: { cluster_proximity: a.spread, rainfall: a.rain, temperature: a.temp },
          mean_temperature_last_4_weeks_c: a.temp_c, rain_station: a.rain_mm_station, reason_from_data: a.reason,
          island_wide_forecast: { current_weekly_cases: meta.current_cases, forecast_weekly_cases_in_4_weeks: meta.forecast_cases, outlook: meta.outlook },
          demo_premises: (await premisesCounts([a.subzone_id]))[a.subzone_id] ?? 0,
        }
      }
      case 'get_area_history': {
        const a = findArea(String(args.area ?? ''))
        if (!a) return { error: `No subzone matches "${args.area}"` }
        const weeks = snapshots().map((s) => ({ epi_week: s.epi_week, rank: s.subzones[a.subzone_id]?.rank ?? null, band: s.subzones[a.subzone_id]?.band ?? null }))
        const insp = (await sql()`
          select i.epi_week, count(*)::int as inspections, count(*) filter (where i.breeding_found)::int as with_breeding,
                 count(*) filter (where i.follow_up_needed and not i.follow_up_done)::int as open_follow_ups
          from inspections i join premises p on p.id = i.premises_id
          where p.subzone_id = ${a.subzone_id} group by 1 order by 1 desc limit 8`) as Record<string, unknown>[]
        return { subzone_id: a.subzone_id, subzone: a.subzone, weekly_ranking: weeks, inspections_by_week_demo_data: insp }
      }
      case 'search_recent_context': {
        const found = await searchRecentContext(String(args.query ?? 'dengue clusters'))
        const out = found.map((s) => {
          const existing = this.sources.find((x) => x.url === s.url)
          if (existing) return existing
          const withId = { ...s, id: `S${this.sources.length + 1}` }
          this.sources.push(withId)
          return withId
        })
        return { sources: out.map((s) => ({ id: s.id, title: s.title, published: s.published, snippet: s.snippet.slice(0, 300) })) }
      }
      default:
        return { error: `Unknown tool ${name}` }
    }
  }
}
