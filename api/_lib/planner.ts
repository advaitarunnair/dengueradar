/**
 * The weekly planning agent (Nemotron Ultra with tool calling).
 * The model chooses areas, explains them and allocates teams; code validates everything, enforces
 * capacity, orders visits (nearest neighbour) and checks that every number came from the data.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { NumberLedger } from './checks.ts'
import { findArea, load, rankedAreas, type Area } from './data.ts'
import { sql } from './db.ts'
import { currentWeek, sgToday } from './epi.ts'
import { startAgentRun } from './guard.ts'
import { complete, MODELS, parseJson } from './llm.ts'
import { allocateTeams, FACTOR_KEYS, hasFigure, regionLabel, renderReason, unsourcedClaim, weekName } from './planrender.ts'
import { nearestNeighbourOrder, splitIntoDays, type Stop } from './routing.ts'
import { gatherContext } from './tavily.ts'
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
  /** Premises visited this week; premises_total is more when the area only partly fitted a team's capacity. */
  premises: number; premises_total: number; reason: string; focus: string; team: string; lat: number; lon: number
  /** The data keys the agent chose; code renders the numbers from them. */
  factors: string[]
}
export interface PlanTeam { name: string; regions: string[]; capacity: number; premises: number; subzone_ids: string[]; days: { day: number; stops: Stop[]; km: number }[] }
export interface Plan {
  epi_week: string; generated_at: string; model: string; constraints: Constraints
  summary: string; areas: PlanArea[]; teams: PlanTeam[]
  context: { id: string; title: string; url: string; published: string | null; note: string }[]
  /** The searches run for context, with how many usable results each returned. */
  context_queries: { label: string; query: string; results: number }[]
  outlook: { current_cases: number; forecast_cases: number; outlook: string; case_week: string; forecast_week: string }
  checks: { numbers_checked: number; unsupported: number[]; dropped: { subzone_id: string; why: string }[]; removed_sentences: string[]; corrections: { where: string; removed: string }[]; rendered: { subzone: string; factors: string[]; text: string }[] }
  agent: { tool_calls: { name: string; args: string }[]; tokens: number; ms: number }
  /** Set on re-plans: what changed versus the previous version (computed in code). */
  changes?: { added: string[]; removed: string[]; moved: { subzone: string; from: string; to: string }[] }
}

export type AgentEvent = { type: 'status'; text: string } | { type: 'tool'; name: string; args: string }

interface ModelPlan {
  summary: string
  team_regions?: Record<string, string[]>
  areas: { subzone_id: string; factors?: string[]; note?: string; focus?: string; team?: string }[]
  context?: { source_id: string; note: string }[]
}

/** Reasoning off: in testing, Ultra with reasoning on invented a tool and fabricated figures for it. */
const THINKING = process.env.PLAN_THINKING === '1'

const SYSTEM = `You are DengueRadar Copilot, the planning agent for an NEA dengue inspection team in Singapore.
You draft the week's inspection plan: which residential subzones to inspect, in priority order, which team takes each, and why.

What the data is (be accurate about it):
- The forecast is ISLAND-WIDE weekly dengue cases. There is no per-subzone forecast; never say a subzone will have a number of cases.
- Each subzone has a transparent rule-based risk index (60% cluster pressure, log-scaled so cluster size counts; 30% rainfall 2 to 8 weeks ago; 10% temperature). It is not validated against future clusters.
- Subzones within 1 km of a cluster of 10 or more cases are always band High and listed first. After them, areas are ordered by band (High, Elevated, Low), then priority = risk squared x square root of residents aged 65+ and under 15. rank_areas returns subzones in this island-wide order; "rank" is the island-wide rank (1 = top priority in Singapore), never a rank within a region.
- Premises and inspection records are DEMO data for this prototype.

Rules:
How to work: first research with the tools (at most 4 rounds), then you will be asked to decide.
1. Call rank_areas with top_n 30. Recent news is searched for you and given to you later.
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
- factors: for each area, 2 to 4 keys saying why it is in the plan, from: ${FACTOR_KEYS.join(', ')}. The app writes the numbers from these keys, so choose what matters most for that area.
- note: max 15 words, your own judgement on this area. NO digits or numbers at all. Do not claim anything over time ("consistently", "recently", "returned") or compare with other areas ("largest in the West"): you only have this week's facts.
- focus: max 12 words, what to check on site. NO digits or numbers.
- summary: 1 to 2 sentences on this week's approach. NO digits or numbers, and do not name teams or regions: the app adds the figures and team labels. Mention serotypes only if you cite a source that says so.
- context: cite only items from the recent context list by id, each with a short note using only what that item says; use [] if none matter. Some items have no date: never call those recent.

Reply with ONLY this JSON object:
{"summary": "", "team_regions": {"<team name>": ["REGION"]}, "areas": [{"subzone_id": "", "factors": ["large_cluster", "seniors_children"], "note": "Largest cluster on the island sits at its edge, so go first", "focus": "Blocks beside the cluster, then shared drains", "team": ""}], "context": [{"source_id": "S1", "note": ""}]}`
}

/** Premises in each area, those with the most past breeding first (they stay in if an area is only partly covered). */
async function premisesFor(ids: string[]): Promise<Stop[]> {
  if (!ids.length) return []
  return (await sql()`select p.id as premises_id, p.code, p.name, p.premises_type, p.subzone_id, p.lat, p.lon
    from premises p left join (select premises_id, count(*) as n from inspections where is_demo and breeding_found group by 1) b on b.premises_id = p.id
    where p.subzone_id = any(${ids}) order by coalesce(b.n, 0) desc, p.id`) as Stop[]
}

async function inspectedLastWeek(session: string): Promise<string[]> {
  const rows = (await sql()`select distinct p.subzone_id from inspections i join premises p on p.id = i.premises_id
                            where i.inspected_on >= ${sgToday()}::date - 7 and (i.is_demo or i.session_id = ${session})`) as { subzone_id: string }[]
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
  if (c.skip_inspected_last_week) for (const id of await inspectedLastWeek(opts.session)) excluded.add(id)

  const brief = [
    `Plan epi week ${currentWeek()}. Island-wide, latest reported: ${meta.current_cases} cases in ${meta.case_week} (data lags, this is not the current week). Forecast ${meta.forecast_cases} for ${meta.forecast_week}, outlook ${meta.outlook}.`,
    `Teams: ${c.teams.join(', ')}. Each team works ${c.days} days at about ${c.per_day} premises a day, so each team can take ${teamCapacity} premises and the total capacity is ${capacity} premises.`,
    excluded.size ? `Do not include these subzones: ${[...excluded].join(', ')}.` : '',
    c.notes.length ? `Officer constraints: ${c.notes.join(' ')}` : '',
    opts.previous ? `Current plan (revise it, keep what still makes sense): ${JSON.stringify(opts.previous.areas.map((a) => ({ subzone_id: a.subzone_id, team: a.team })))}` : '',
    opts.instruction ? `The officer asks: "${opts.instruction}"` : '',
  ].filter(Boolean).join('\n')

  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: brief }]
  const runner = new ToolRunner()
  const toolCalls: { name: string; args: string }[] = []
  let tokens = 0
  opts.onEvent?.({ type: 'status', text: 'Reading this week’s forecast and rankings' })
  const researchTools = TOOLS.filter((t) => t.type === 'function' && !['search_recent_context', 'search_news'].includes(t.function.name))
  const known = new Set(researchTools.map((t) => (t.type === 'function' ? t.function.name : '')))
  // Phase 1: research. The agent decides which tools to call; its prose is discarded.
  const candidates = new Map<string, number>() // subzone_id -> rank, from every rank_areas result
  for (let step = 0; step < 4; step++) {
    const r = await complete({
      model: 'ULTRA', endpoint: 'plan', session: opts.session, messages,
      maxTokens: 500, thinking: THINKING, temperature: 0.2, tools: researchTools,
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
      if (call.function.name === 'rank_areas') for (const a of (result as { areas?: { subzone_id: string; rank: number }[] }).areas ?? []) candidates.set(a.subzone_id, a.rank)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  if (!candidates.size) for (const a of rankedAreas().slice(0, 30)) candidates.set(a.subzone_id, a.rank!) // agent skipped rank_areas

  // Recent context: targeted searches run in code, cached per week per query, given as structured items.
  const top = [...new Set(rankedAreas().filter((a) => !excluded.has(a.subzone_id)).slice(0, 6).map((a) => a.planning_area))].slice(0, 3)
  const gathered = await gatherContext(top)
  for (const q of gathered.queries) {
    toolCalls.push({ name: 'search_recent_context', args: JSON.stringify({ query: q.query }) })
    opts.onEvent?.({ type: 'tool', name: 'search_recent_context', args: JSON.stringify({ query: q.query }) })
  }
  const items = gathered.sources.map((x) => ({ id: x.id, title: x.title, published: x.published ?? 'no date given', snippet: x.snippet.slice(0, 260) }))
  messages.push({ role: 'user', content: `Recent context list (cite by id only if it matters to the plan):\n${JSON.stringify(items)}` })

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
                 { role: 'user', content: `Required shape: {"summary": "...", "team_regions": {}, "areas": [{"subzone_id","factors","note","focus","team"}], "context": [{"source_id","note"}]}\n\nText:\n${text}` }],
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

  // One repair pass: text the model wrote with figures is rewritten without them, keeping the qualitative point.
  // The originals go in the verifier's log; anything that still has a figure is then removed by renderReason.
  const earlyCorrections: { where: string; removed: string }[] = []
  const needsNote = chosen.filter((a) => a.note && hasFigure(String(a.note), findArea(a.subzone_id)!))
  const needsFocus = chosen.filter((a) => a.focus && hasFigure(String(a.focus), findArea(a.subzone_id)!))
  const summaryHasFigures = /\d/.test(String(parsed.summary ?? ''))
  if (needsNote.length || needsFocus.length || summaryHasFigures) {
    opts.onEvent?.({ type: 'status', text: 'Rewriting text that contained numbers (Nemotron Super)' })
    try {
      const fix = await complete({
        model: 'SUPER', endpoint: 'plan-rewrite', session: opts.session, maxTokens: 1500, json: true, temperature: 0,
        messages: [{ role: 'system', content: 'Rewrite each text so it contains no digits or figures, keeping only its qualitative point in at most 15 words (the summary: at most 2 sentences). Do not name teams or regions in the summary. If nothing qualitative remains, return an empty string. Keep the same keys. Reply with ONLY JSON.' },
                   { role: 'user', content: JSON.stringify({ notes: Object.fromEntries(needsNote.map((a) => [a.subzone_id, a.note])), focus: Object.fromEntries(needsFocus.map((a) => [a.subzone_id, a.focus])), summary: summaryHasFigures ? parsed.summary : '' }) }],
      })
      tokens += fix.usage.prompt + fix.usage.completion
      const out = parseJson<{ notes?: Record<string, string>; focus?: Record<string, string>; summary?: string }>(fix.text)
      for (const a of needsNote) { earlyCorrections.push({ where: `${findArea(a.subzone_id)!.subzone} note rewritten; original`, removed: String(a.note) }); a.note = out.notes?.[a.subzone_id] ?? '' }
      for (const a of needsFocus) { earlyCorrections.push({ where: `${findArea(a.subzone_id)!.subzone} focus rewritten; original`, removed: String(a.focus) }); a.focus = out.focus?.[a.subzone_id] ?? '' }
      if (summaryHasFigures) { earlyCorrections.push({ where: 'Summary rewritten; original', removed: String(parsed.summary) }); parsed.summary = out.summary ?? '' }
    } catch (e) {
      console.error(e) // the verifier below still removes anything with a figure
    }
  }

  // Serotype claims need a cited source; the note goes, or the sentence below, and the verifier log says so.
  const citedSources = (parsed.context ?? []).map((x) => gathered.sources.find((s) => s.id === x.source_id)).map((s) => (s ? `${s.title} ${s.snippet}` : '')).join(' ')
  for (const a of chosen) {
    for (const field of ['note', 'focus'] as const) {
      if (a[field] && unsourcedClaim(String(a[field]), citedSources)) {
        earlyCorrections.push({ where: `${findArea(a.subzone_id)!.subzone} ${field}, no cited source`, removed: String(a[field]) })
        a[field] = ''
      }
    }
  }

  // Large active clusters must be covered: any override area the model skipped is added.
  for (const area of rankedAreas()) {
    if (area.cluster_override && !excluded.has(area.subzone_id) && !chosen.some((x) => x.subzone_id === area.subzone_id)) chosen.push({ subzone_id: area.subzone_id })
  }
  // Allocate in island priority order so the top areas get a team first.
  chosen.sort((x, y) => (findArea(x.subzone_id)!.rank ?? 999) - (findArea(y.subzone_id)!.rank ?? 999))
  const stops = await premisesFor(chosen.map((a) => a.subzone_id))
  const homes: Record<string, string[]> = Object.fromEntries(c.teams.map((t) => [t, (parsed.team_regions?.[t] ?? []).map((r) => r.toUpperCase().replace(' REGION', ''))]))
  const allocation = allocateTeams(
    chosen.map((a) => ({ area: findArea(a.subzone_id)!, team: a.team, stops: stops.filter((s) => s.subzone_id === a.subzone_id) })),
    c.teams, teamCapacity, homes,
  )
  dropped.push(...allocation.dropped)

  const corrections: { where: string; removed: string }[] = [...earlyCorrections]
  const rendered: { subzone: string; factors: string[]; text: string }[] = []
  const areas: PlanArea[] = allocation.placements.map((pl, i) => {
    const d = findArea(pl.subzone_id)!
    const m = chosen.find((x) => x.subzone_id === pl.subzone_id)!
    const r = renderReason(d, m.factors, m.note, m.focus)
    for (const x of r.corrections) corrections.push({ where: `${d.subzone} ${x.field}`, removed: x.removed })
    rendered.push({ subzone: d.subzone, factors: r.factors, text: r.reason })
    return {
      order: i + 1, subzone_id: d.subzone_id, subzone: d.subzone, planning_area: d.planning_area,
      region: d.region.replace(' REGION', ''), rank: d.rank!, band: d.band!, risk: d.risk!, vulnerable: d.vulnerable,
      clusters_within_1km: d.clusters_within_1km, cluster_cases_within_1km: d.cluster_cases_within_1km,
      nearest_cluster_km: d.nearest_cluster_km, premises: pl.stops.length, premises_total: pl.premises_total,
      reason: r.reason, focus: r.focus, factors: r.factors, team: pl.team, lat: d.lat, lon: d.lon,
    }
  })

  const teams: PlanTeam[] = c.teams.map((name) => {
    const mine = allocation.placements.filter((p) => p.team === name)
    const own = mine.flatMap((p) => p.stops)
    const first = areas.find((a) => a.team === name)
    const order = nearestNeighbourOrder(own, first ? { lat: first.lat, lon: first.lon } : undefined)
    const regions = [...new Set(areas.filter((a) => a.team === name).map((a) => a.region))]
    return { name, regions, capacity: teamCapacity, premises: own.length, subzone_ids: mine.map((p) => p.subzone_id), days: splitIntoDays(order, c.per_day, c.days) }
  })

  const context = (parsed.context ?? []).flatMap((x) => {
    const s = gathered.sources.find((src) => src.id === x.source_id)
    if (!s) return []
    // A note may quote numbers from its own source (e.g. "DENV-3"), but nothing else.
    const note = String(x.note ?? '')
    const own = new NumberLedger()
    own.add(`${s.title} ${s.snippet}`)
    if (own.unsupported(note.replace(/DENV-\d/gi, '')).length) { corrections.push({ where: `note on ${s.id}`, removed: note }); return [{ id: s.id, title: s.title, url: s.url, published: s.published, note: '' }] }
    return [{ id: s.id, title: s.title, url: s.url, published: s.published, note }]
  })

  // The model's sentences must have no numbers; a sentence with one is removed and reported. The figures and
  // team labels around them are written by code, so the summary always matches the cards.
  const sentences = String(parsed.summary ?? '').split(/(?<=[.!?])\s+/).filter(Boolean)
  const removedSentences = sentences.filter((x) => /\d/.test(x))
  for (const x of sentences) if (!/\d/.test(x) && unsourcedClaim(x, citedSources)) corrections.push({ where: 'Summary sentence, no cited source', removed: x })
  const judgement = sentences.filter((x) => !/\d/.test(x) && !unsourcedClaim(x, citedSources)).join(' ')
  const figures = `Latest reported: ${meta.current_cases} cases in ${weekName(meta.case_week)}; forecast ${meta.forecast_cases} for ${weekName(meta.forecast_week)} (${meta.outlook}).`
  const teamLine = teams.filter((t) => t.premises).map((t) => `${t.name} covers ${regionLabel(t.regions)} (${t.premises} of ${t.capacity} premises)`).join('; ')
  const summary = [figures, judgement, teamLine ? `${teamLine}.` : ''].filter(Boolean).join(' ')
  const allText = [summary, ...areas.map((a) => `${a.reason} ${a.focus}`)].join('\n')

  return {
    epi_week: currentWeek(), generated_at: new Date().toISOString(), model: MODELS.ULTRA, constraints: c,
    summary, areas, teams, context, context_queries: gathered.queries,
    outlook: { current_cases: meta.current_cases, forecast_cases: meta.forecast_cases, outlook: meta.outlook, case_week: meta.case_week, forecast_week: meta.forecast_week },
    checks: { numbers_checked: (allText.match(/\d[\d,.]*/g) ?? []).length, unsupported: [], dropped, removed_sentences: removedSentences, corrections, rendered },
    agent: { tool_calls: toolCalls, tokens, ms: Date.now() - t0 },
  }
}

export async function savePlan(plan: Plan, source: string, session: string | null, canonical = false): Promise<{ id: number; version: number }> {
  const [row] = (await sql()`
    insert into plans (epi_week, version, plan, constraints, model, source, session_id, is_canonical)
    values (${plan.epi_week}, coalesce((select max(version) from plans where epi_week = ${plan.epi_week}
              and (session_id is not distinct from ${session} or is_canonical)), 0) + 1,
            ${JSON.stringify(plan)}::jsonb, ${JSON.stringify(plan.constraints)}::jsonb, ${plan.model}, ${source}, ${session}, ${canonical})
    returning id, version`) as { id: number; version: number }[]
  return row
}

/** Areas ranked just below the plan, so the UI can show what was left out. */
export function nextCandidates(plan: Plan, n = 5) {
  const inPlan = new Set(plan.areas.map((a) => a.subzone_id))
  return rankedAreas().filter((a) => !inPlan.has(a.subzone_id)).slice(0, n)
    .map((a) => ({ subzone_id: a.subzone_id, subzone: a.subzone, rank: a.rank, band: a.band }))
}
