/**
 * The weekly planning agent (Nemotron Ultra with tool calling).
 * The model chooses areas, explains them and allocates teams; code validates everything, enforces
 * capacity, orders visits (nearest neighbour) and checks that every number came from the data.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { NumberLedger } from './checks.ts'
import { distanceKm, findArea, load, rankedAreas, type Area } from './data.ts'
import { sql } from './db.ts'
import { startAgentRun } from './guard.ts'
import { complete, MODELS, parseJson } from './llm.ts'
import { nearestNeighbourOrder, splitIntoDays, type Stop } from './routing.ts'
import { TOOLS, ToolRunner } from './tools.ts'

export interface Constraints {
  teams: string[]
  days: number
  per_day: number
  skip_subzones: string[]
  skip_inspected_last_week: boolean
  notes: string[]
}
export const DEFAULT_CONSTRAINTS: Constraints = {
  teams: ['Team Alpha', 'Team Bravo', 'Team Charlie'], days: 5, per_day: 6,
  skip_subzones: [], skip_inspected_last_week: false, notes: [],
}

export interface PlanArea {
  order: number; subzone_id: string; subzone: string; planning_area: string; region: string
  rank: number; band: string; risk: number; vulnerable: number
  clusters_within_1km: number; cluster_cases_within_1km: number; nearest_cluster_km: number | null
  premises: number; reason: string; focus: string; team: string; lat: number; lon: number
  /** 'agent' = written by Nemotron and verified; 'data' = the agent's text failed verification, so code wrote it. */
  reason_source: 'agent' | 'data'
}
export interface PlanTeam { name: string; regions: string[]; capacity: number; premises: number; subzone_ids: string[]; days: { day: number; stops: Stop[]; km: number }[] }
export interface Plan {
  epi_week: string; generated_at: string; model: string; constraints: Constraints
  summary: string; areas: PlanArea[]; teams: PlanTeam[]
  context: { id: string; title: string; url: string; published: string | null; note: string }[]
  outlook: { current_cases: number; forecast_cases: number; outlook: string; case_week: string; forecast_week: string }
  checks: { numbers_checked: number; unsupported: number[]; dropped: { subzone_id: string; why: string }[]; replaced: { subzone: string; numbers: number[] }[] }
  agent: { tool_calls: { name: string; args: string }[]; tokens: number; ms: number }
}

export type AgentEvent = { type: 'status'; text: string } | { type: 'tool'; name: string; args: string }

interface ModelPlan {
  summary: string
  team_regions?: Record<string, string[]>
  areas: { subzone_id: string; reason: string; focus: string; team: string }[]
  context?: { source_id: string; note: string }[]
}

/** Reasoning off: in testing, Ultra with reasoning on invented a tool and fabricated figures for it. */
const THINKING = process.env.PLAN_THINKING === '1'

const SYSTEM = `You are DengueRadar Copilot, the planning agent for an NEA dengue inspection team in Singapore.
You draft the week's inspection plan: which residential subzones to inspect, in priority order, which team takes each, and why.

What the data is (be accurate about it):
- The forecast is ISLAND-WIDE weekly dengue cases. There is no per-subzone forecast; never say a subzone will have a number of cases.
- Each subzone has a transparent rule-based risk index (60% proximity to active clusters, 30% rainfall 2 to 8 weeks ago, 10% temperature). It is not validated against future clusters.
- Priority = risk index x residents aged 65+ and under 15. rank_areas returns subzones in island-wide priority order; "rank" is the island-wide rank (1 = top priority in Singapore), never a rank within a region.
- Premises and inspection records are DEMO data for this prototype.

Rules:
How to work: first research with the tools (at most 4 rounds), then you will be asked to decide.
1. Call rank_areas with top_n 30 and search_recent_context once (recent Singapore dengue or weather news), in the same round.
2. rank_areas already has what you need for most areas. Use get_area_risk or get_area_history for at most 3 areas where the detail would change your decision.
3. When your research is done, reply with the single word DONE.

Rules for everything you write:
- Every number must be copied from a tool result. Do not calculate new numbers, percentages or totals.
- Only use the tools listed. Never describe data you did not receive from a tool.
- Respect every officer constraint you are given.`

/** The facts an area's reason may use, written by code from our data (also the fallback reason). */
export function areaFacts(a: Area): string {
  const cl = a.clusters_within_1km > 0
    ? `${a.clusters_within_1km} active cluster${a.clusters_within_1km > 1 ? 's' : ''} within 1 km (${a.cluster_cases_within_1km} cases)`
    : a.nearest_cluster_km !== null ? `nearest active cluster ${a.nearest_cluster_km} km away` : 'no active clusters'
  return `${cl}; rainfall 2 to 8 weeks ago ${a.rain_mm} mm; ${a.vulnerable.toLocaleString('en-SG')} seniors and children; island rank ${a.rank}, ${a.band}`
}

function decisionPrompt(table: string, capacity: number, teamCapacity: number, low: number, teams: string[]): string {
  return `Research is done. Now decide this week's plan.

Choose areas ONLY from this candidate table (use subzone_id exactly as written). It is in priority order.
"premises" is the area's own number of demo premises. "running_total" is only for capacity planning: it is NOT a property of the area, never quote it.
"facts" are the only facts you may state about that area.
subzone_id | subzone | region | premises | running_total | facts
${table}

- Take areas in priority order unless a constraint or your research gives a clear reason to skip one; stop once running_total is between ${low} and ${capacity} (total capacity ${capacity}).
- First give each team a home: one region, or two neighbouring regions (WEST, CENTRAL, NORTH, NORTH-EAST, EAST), based on where the chosen areas are. Then assign each chosen area to a team whose home includes the area's region. Teams: ${teams.join(', ')}. Each team takes at most ${teamCapacity} premises and every team must get areas. If an area does not fit its region's team, skip it and take the next candidate rather than sending a team across the island.
- reason: max 30 words, why this area is in the plan. Use ONLY that area's own "facts" (copy numbers exactly); do not mention other areas' numbers.
- focus: max 12 words, what to check on site.
- context: cite only Singapore-relevant sources from search_recent_context by id; use [] if none are relevant.

Reply with ONLY this JSON object:
{"summary": "2-3 sentences on this week's situation and approach", "team_regions": {"<team name>": ["REGION"]}, "areas": [{"subzone_id": "", "reason": "", "focus": "", "team": ""}], "context": [{"source_id": "S1", "note": "max 20 words"}]}`
}

/** An area further than this from a team's other areas is skipped rather than assigned to that team. */
const MAX_DETOUR_KM = 8

async function premisesFor(ids: string[]): Promise<Stop[]> {
  if (!ids.length) return []
  return (await sql()`select id as premises_id, code, name, premises_type, subzone_id, lat, lon
                      from premises where subzone_id = any(${ids}) order by id`) as Stop[]
}

async function inspectedLastWeek(): Promise<string[]> {
  const rows = (await sql()`select distinct p.subzone_id from inspections i join premises p on p.id = i.premises_id
                            where i.inspected_on >= current_date - 7`) as { subzone_id: string }[]
  return rows.map((r) => r.subzone_id)
}

export async function generatePlan(opts: {
  session: string
  constraints: Constraints
  previous?: Plan | null
  instruction?: string
  onEvent?: (e: AgentEvent) => void
}): Promise<Plan> {
  await startAgentRun(opts.session)
  const t0 = Date.now()
  const { meta } = load()
  const c = opts.constraints
  const teamCapacity = c.days * c.per_day
  const capacity = teamCapacity * c.teams.length
  const excluded = new Set(c.skip_subzones.map((s) => findArea(s)?.subzone_id ?? s))
  if (c.skip_inspected_last_week) for (const id of await inspectedLastWeek()) excluded.add(id)

  const ledger = new NumberLedger()
  ledger.add({ c, capacity, teamCapacity, teams: c.teams.length })
  ledger.add(meta)

  const brief = [
    `Plan epi week ${meta.epi_week}. Island-wide: ${meta.current_cases} cases in ${meta.case_week}, forecast ${meta.forecast_cases} for ${meta.forecast_week}, outlook ${meta.outlook}.`,
    `Teams: ${c.teams.join(', ')}. Each team works ${c.days} days at about ${c.per_day} premises a day, so each team can take ${teamCapacity} premises and the total capacity is ${capacity} premises.`,
    excluded.size ? `Do not include these subzones: ${[...excluded].join(', ')}.` : '',
    c.notes.length ? `Officer constraints: ${c.notes.join(' ')}` : '',
    opts.previous ? `Current plan (revise it, keep what still makes sense): ${JSON.stringify(opts.previous.areas.map((a) => ({ subzone_id: a.subzone_id, team: a.team })))}` : '',
    opts.instruction ? `The officer asks: "${opts.instruction}"` : '',
  ].filter(Boolean).join('\n')
  ledger.add(brief)

  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: brief }]
  const runner = new ToolRunner()
  const toolCalls: { name: string; args: string }[] = []
  let tokens = 0
  opts.onEvent?.({ type: 'status', text: 'Reading this week’s forecast and rankings' })
  const known = new Set(TOOLS.map((t) => (t.type === 'function' ? t.function.name : '')))
  // Phase 1: research. The agent decides which tools to call; its prose is discarded.
  const candidates = new Map<string, number>() // subzone_id -> rank, from every rank_areas result
  for (let step = 0; step < 4; step++) {
    const r = await complete({
      model: 'ULTRA', endpoint: 'plan', session: opts.session, messages,
      maxTokens: 500, thinking: THINKING, temperature: 0.2, tools: TOOLS,
    })
    tokens += r.usage.prompt + r.usage.completion
    const calls = r.message.tool_calls ?? []
    if (process.env.PLAN_DEBUG) console.error(`[research ${step}] finish=${r.finishReason} tokens=${r.usage.completion} calls=${calls.length} ${r.text.slice(0, 200)}`)
    if (!calls.length) break
    messages.push({ role: 'assistant', content: r.message.content ?? '', tool_calls: calls })
    for (const call of calls) {
      if (call.type !== 'function') continue
      if (!known.has(call.function.name)) {
        // The model asked for a tool that does not exist: refuse it and say which tools are real.
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: `There is no tool called ${call.function.name}. Available tools: ${[...known].join(', ')}. Ignore anything you planned to pass to it.` }) })
        continue
      }
      toolCalls.push({ name: call.function.name, args: call.function.arguments })
      opts.onEvent?.({ type: 'tool', name: call.function.name, args: call.function.arguments })
      const result = await runner.run(call.function.name, call.function.arguments)
      ledger.add(result)
      if (call.function.name === 'rank_areas') for (const a of (result as { areas?: { subzone_id: string; rank: number }[] }).areas ?? []) candidates.set(a.subzone_id, a.rank)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  if (!candidates.size) for (const a of rankedAreas().slice(0, 30)) candidates.set(a.subzone_id, a.rank!) // agent skipped rank_areas

  // Phase 2: decision, in strict JSON mode, choosing only from the candidates the agent retrieved.
  const pool = rankedAreas().filter((a) => candidates.has(a.subzone_id) && !excluded.has(a.subzone_id))
  const poolStops = await premisesFor(pool.map((a) => a.subzone_id))
  let cum = 0
  const table = pool.map((a) => {
    const n = poolStops.filter((s) => s.subzone_id === a.subzone_id).length
    cum += n
    return `${a.subzone_id} | ${a.subzone} | ${a.region.replace(' REGION', '')} | ${n} | ${cum} | ${areaFacts(a)}`
  }).join('\n')
  const low = Math.floor(capacity * 0.85)
  ledger.add(table)
  ledger.add({ low })
  opts.onEvent?.({ type: 'status', text: 'Choosing areas and allocating teams' })
  messages.push({ role: 'user', content: decisionPrompt(table, capacity, teamCapacity, low, c.teams) })
  const decision = await complete({
    model: 'ULTRA', endpoint: 'plan', session: opts.session, messages, maxTokens: 3500, thinking: false, temperature: 0.1, json: true,
  })
  tokens += decision.usage.prompt + decision.usage.completion
  const text = decision.text
  if (process.env.PLAN_DEBUG) console.error(`[decision] finish=${decision.finishReason} tokens=${decision.usage.completion}\n${text.slice(0, 1500)}`)

  opts.onEvent?.({ type: 'status', text: 'Checking the plan against the data and team capacity' })
  let parsed: ModelPlan
  try {
    parsed = parseJson<ModelPlan>(text)
  } catch {
    // One repair pass with Super: reformat the agent's answer as the required JSON.
    const fix = await complete({
      model: 'SUPER', endpoint: 'plan-repair', session: opts.session, maxTokens: 2500, json: true,
      messages: [{ role: 'system', content: 'Convert the text into the JSON object it describes. Keep every value exactly; output JSON only.' },
                 { role: 'user', content: `Required shape: {"summary": "...", "areas": [{"subzone_id","reason","focus","team"}], "context": [{"source_id","note"}]}\n\nText:\n${text}` }],
    })
    tokens += fix.usage.prompt + fix.usage.completion
    parsed = parseJson<ModelPlan>(fix.text)
  }

  // Validate areas: must exist, be ranked, not excluded, not duplicated.
  const dropped: { subzone_id: string; why: string }[] = []
  const chosen: ModelPlan['areas'] = []
  for (const a of parsed.areas ?? []) {
    const area = findArea(a.subzone_id)
    if (!area || !area.eligible || area.rank === null) { dropped.push({ subzone_id: a.subzone_id, why: 'not a ranked subzone' }); continue }
    if (excluded.has(area.subzone_id)) { dropped.push({ subzone_id: area.subzone_id, why: 'excluded by a constraint' }); continue }
    if (chosen.some((x) => x.subzone_id === area.subzone_id)) continue
    chosen.push({ ...a, subzone_id: area.subzone_id })
  }

  // Team allocation. The model sets each team's home regions and proposes a team per area; code keeps the
  // proposal when it matches the team's home and capacity, otherwise uses the team whose home covers the
  // area's region, otherwise the nearest team with room. Geometry stays in code.
  const stops = await premisesFor(chosen.map((a) => a.subzone_id))
  const count = (id: string) => stops.filter((s) => s.subzone_id === id).length
  const load_: Record<string, number> = Object.fromEntries(c.teams.map((t) => [t, 0]))
  const homes: Record<string, string[]> = Object.fromEntries(c.teams.map((t) => [t, (parsed.team_regions?.[t] ?? []).map((r) => r.toUpperCase().replace(' REGION', ''))]))
  const placed: Record<string, { lat: number; lon: number }[]> = Object.fromEntries(c.teams.map((t) => [t, []]))
  const areas: PlanArea[] = []
  const replaced: { subzone: string; numbers: number[] }[] = []
  for (const a of chosen) {
    const n = count(a.subzone_id)
    const d0 = findArea(a.subzone_id)!
    const region = d0.region.replace(' REGION', '')
    const fits = (t: string) => load_[t] + n <= teamCapacity
    const home = (t: string) => homes[t].includes(region)
    const centroidKm = (t: string) => {
      const pts = placed[t]
      if (!pts.length) return Number.POSITIVE_INFINITY
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length
      return distanceKm({ lat, lon }, d0)
    }
    let team: string | undefined = c.teams.includes(a.team) && fits(a.team) && (home(a.team) || !homes[a.team].length) ? a.team : undefined
    team ??= c.teams.filter((t) => home(t) && fits(t)).sort((x, y) => load_[x] - load_[y])[0]
    // Otherwise the nearest team with room, but never across the island: skip the area instead.
    team ??= c.teams.filter((t) => fits(t) && (centroidKm(t) <= MAX_DETOUR_KM || !placed[t].length)).sort((x, y) => centroidKm(x) - centroidKm(y) || load_[x] - load_[y])[0]
    if (!team) { dropped.push({ subzone_id: a.subzone_id, why: c.teams.some(fits) ? 'no team with room nearby' : 'over team capacity' }); continue }
    placed[team].push(d0)
    load_[team] += n
    const d = findArea(a.subzone_id)!
    areas.push({
      order: areas.length + 1, subzone_id: d.subzone_id, subzone: d.subzone, planning_area: d.planning_area,
      region: d.region.replace(' REGION', ''), rank: d.rank!, band: d.band!, risk: d.risk!, vulnerable: d.vulnerable,
      clusters_within_1km: d.clusters_within_1km, cluster_cases_within_1km: d.cluster_cases_within_1km,
      nearest_cluster_km: d.nearest_cluster_km, premises: n, reason: a.reason, focus: a.focus, team, lat: d.lat, lon: d.lon,
      reason_source: 'agent',
    })
    // Each reason may only use its own area's facts; otherwise show the facts written by code instead.
    const own = new NumberLedger()
    own.add(areaFacts(d))
    own.add({ n, rank: d.rank, risk: d.risk, nearest: d.nearest_cluster_km, temp: d.temp_c })
    const bad = own.unsupported(`${a.reason}\n${a.focus}`)
    if (bad.length || !a.reason) {
      const last = areas[areas.length - 1]
      replaced.push({ subzone: d.subzone, numbers: bad })
      last.reason = areaFacts(d)
      last.reason_source = 'data'
      if (bad.length && own.unsupported(a.focus).length) last.focus = ''
    }
  }

  const teams: PlanTeam[] = c.teams.map((name) => {
    const ids = areas.filter((a) => a.team === name).map((a) => a.subzone_id)
    const own = stops.filter((s) => ids.includes(s.subzone_id))
    const first = areas.find((a) => a.team === name)
    const order = nearestNeighbourOrder(own, first ? { lat: first.lat, lon: first.lon } : undefined)
    const regions = [...new Set(areas.filter((a) => a.team === name).map((a) => a.region))]
    return { name, regions, capacity: teamCapacity, premises: own.length, subzone_ids: ids, days: splitIntoDays(order, c.per_day, c.days) }
  })

  const context = (parsed.context ?? []).flatMap((x) => {
    const s = runner.sources.find((src) => src.id === x.source_id)
    return s ? [{ id: s.id, title: s.title, url: s.url, published: s.published, note: x.note }] : []
  })

  const written = [parsed.summary, ...context.map((x) => x.note)].join('\n')
  const areaText = areas.map((a) => `${a.reason} ${a.focus}`).join('\n')
  // Snippets of cited sources may legitimately contain numbers (e.g. cluster case counts in a news story).
  for (const s of runner.sources) ledger.add(s.snippet + ' ' + s.title)
  // Totals the summary might state correctly, computed by code.
  ledger.add({ areas: areas.length, premises: areas.reduce((t, a) => t + a.premises, 0), regions: new Set(areas.map((a) => a.region)).size })
  const unsupported = ledger.unsupported(written)

  return {
    epi_week: meta.epi_week, generated_at: new Date().toISOString(), model: MODELS.ULTRA, constraints: c,
    summary: parsed.summary ?? '', areas, teams, context,
    outlook: { current_cases: meta.current_cases, forecast_cases: meta.forecast_cases, outlook: meta.outlook, case_week: meta.case_week, forecast_week: meta.forecast_week },
    checks: { numbers_checked: ((written + areaText).match(/\d[\d,.]*/g) ?? []).length, unsupported, dropped, replaced },
    agent: { tool_calls: toolCalls, tokens, ms: Date.now() - t0 },
  }
}

export async function savePlan(plan: Plan, source = 'app'): Promise<{ id: number; version: number }> {
  const [row] = (await sql()`
    insert into plans (epi_week, version, plan, constraints, model, source)
    values (${plan.epi_week}, coalesce((select max(version) from plans where epi_week = ${plan.epi_week}), 0) + 1,
            ${JSON.stringify(plan)}::jsonb, ${JSON.stringify(plan.constraints)}::jsonb, ${plan.model}, ${source})
    returning id, version`) as { id: number; version: number }[]
  return row
}

/** Areas ranked just below the plan, so the UI can show what was left out. */
export function nextCandidates(plan: Plan, n = 5) {
  const inPlan = new Set(plan.areas.map((a) => a.subzone_id))
  return rankedAreas().filter((a) => !inPlan.has(a.subzone_id)).slice(0, n)
    .map((a) => ({ subzone_id: a.subzone_id, subzone: a.subzone, rank: a.rank, band: a.band }))
}
