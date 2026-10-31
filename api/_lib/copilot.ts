/**
 * The plan copilot. Super reads each officer message and decides: answer a question (with tools, grounded
 * in our data) or re-plan with new constraints (escalated to the Ultra planning agent).
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { NumberLedger } from './checks.ts'
import { findArea } from './data.ts'
import { sql } from './db.ts'
import { currentWeek } from './epi.ts'
import { complete, parseJson } from './llm.ts'
import { DEFAULT_CONSTRAINTS, generatePlan, savePlan, type AgentEvent, type Constraints, type Plan } from './planner.ts'
import { planById, type PlanRecord } from './plans.ts'
import { TOOLS, ToolRunner } from './tools.ts'

const TEAM_NAMES = ['Team Alpha', 'Team Bravo', 'Team Charlie', 'Team Delta', 'Team Echo', 'Team Foxtrot']

interface Intent {
  intent: 'question' | 'replan'
  team_count?: number | null
  days?: number | null
  per_day?: number | null
  skip_areas?: string[] | null
  include_areas?: string[] | null
  skip_inspected_last_week?: boolean | null
  note?: string | null
}

const ROUTER = `You route messages from an NEA dengue inspection officer about this week's inspection plan.
Decide whether the officer is asking a QUESTION (why, what, explain, compare) or asking to CHANGE the plan (constraints, skip, add, fewer teams, capacity, re-plan).
Extract any constraint changes. Reply with ONLY JSON:
{"intent": "question" | "replan",
 "team_count": number or null, "days": number or null, "per_day": number or null (premises per team per day),
 "skip_areas": [area names to remove] or null, "include_areas": [area names the officer wants added] or null,
 "skip_inspected_last_week": true/false or null,
 "note": "any other instruction for the planner, in a short sentence" or null}`

export function mergeConstraints(c: Constraints, i: Intent): Constraints {
  const n = i.team_count && i.team_count > 0 ? Math.min(TEAM_NAMES.length, Math.round(i.team_count)) : null
  const teams = n ? TEAM_NAMES.slice(0, n) : c.teams
  const skip = [...c.skip_subzones]
  for (const name of i.skip_areas ?? []) {
    const a = findArea(name)
    if (a && !skip.includes(a.subzone_id)) skip.push(a.subzone_id)
  }
  const include = (i.include_areas ?? []).map((x) => findArea(x)?.subzone_id).filter(Boolean) as string[]
  return {
    teams,
    days: i.days && i.days > 0 ? Math.min(7, Math.round(i.days)) : c.days,
    per_day: i.per_day && i.per_day > 0 ? Math.min(30, Math.round(i.per_day)) : c.per_day,
    skip_subzones: skip.filter((id) => !include.includes(id)),
    skip_inspected_last_week: i.skip_inspected_last_week ?? c.skip_inspected_last_week,
    notes: [...c.notes, ...(include.length ? [`Include if capacity allows: ${include.join(', ')}.`] : []), ...(i.note ? [i.note] : [])].slice(-6),
  }
}

/** What changed between two plan versions, computed in code. */
export function diffPlans(before: Plan, after: Plan): NonNullable<Plan['changes']> {
  const b = new Map(before.areas.map((a) => [a.subzone_id, a]))
  const a = new Map(after.areas.map((x) => [x.subzone_id, x]))
  const name = (s: string) => s.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())
  return {
    added: after.areas.filter((x) => !b.has(x.subzone_id)).map((x) => name(x.subzone)),
    removed: before.areas.filter((x) => !a.has(x.subzone_id)).map((x) => name(x.subzone)),
    moved: after.areas.filter((x) => b.has(x.subzone_id) && b.get(x.subzone_id)!.team !== x.team)
      .map((x) => ({ subzone: name(x.subzone), from: b.get(x.subzone_id)!.team, to: x.team })),
  }
}

function describeChanges(ch: NonNullable<Plan['changes']>, before: Constraints, after: Constraints): string {
  const parts: string[] = []
  if (before.teams.length !== after.teams.length) parts.push(`teams: ${before.teams.length} → ${after.teams.length}`)
  if (before.per_day !== after.per_day) parts.push(`premises per team per day: ${before.per_day} → ${after.per_day}`)
  if (before.days !== after.days) parts.push(`days: ${before.days} → ${after.days}`)
  if (ch.added.length) parts.push(`added ${ch.added.join(', ')}`)
  if (ch.removed.length) parts.push(`removed ${ch.removed.join(', ')}`)
  if (ch.moved.length) parts.push(`moved ${ch.moved.map((m) => `${m.subzone} (${m.from} → ${m.to})`).join(', ')}`)
  return parts.length ? `Re-planned: ${parts.join('; ')}.` : 'Re-planned: no areas changed.'
}

async function saveMessage(session: string, week: string, role: 'user' | 'assistant', content: string, planId: number | null) {
  await sql()`insert into plan_messages (epi_week, role, content, plan_id, session_id) values (${week}, ${role}, ${content}, ${planId}, ${session})`
}

async function answer(session: string, record: PlanRecord, question: string, history: { role: string; content: string }[], onEvent: (e: AgentEvent) => void) {
  const plan = record.plan
  const ledger = new NumberLedger()
  const planBrief = {
    constraints: plan.constraints,
    outlook: plan.outlook,
    areas: plan.areas.map((a) => ({ order: a.order, subzone_id: a.subzone_id, subzone: a.subzone, team: a.team, rank: a.rank, band: a.band, premises: a.premises, reason: a.reason })),
    teams: plan.teams.map((t) => ({ name: t.name, regions: t.regions, premises: t.premises, capacity: t.capacity })),
    left_out: plan.checks.dropped,
  }
  ledger.add(planBrief)
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: `You are DengueRadar Copilot, helping an NEA inspection officer understand this week's plan.
Answer in at most 120 words, plainly. Use the tools to look up any area you discuss. Every number must come from the plan below or a tool result; never invent or calculate numbers.
"rank" is the island-wide order: subzones within 1 km of a cluster of 10+ cases first (always band High), then by band (High, Elevated, Low), then priority = risk squared x square root of seniors and children. The forecast is island-wide only. The risk index is rule-based and unvalidated. Premises and inspections are demo data.
Current plan: ${JSON.stringify(planBrief)}` },
    ...history.slice(-6).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: question },
  ]
  const runner = new ToolRunner()
  const tools = TOOLS.filter((t) => t.type === 'function' && t.function.name !== 'search_recent_context')
  let text = ''
  for (let step = 0; step < 4; step++) {
    const r = await complete({ model: 'SUPER', endpoint: 'copilot', session, messages, maxTokens: 500, tools: step < 3 ? tools : undefined })
    const calls = r.message.tool_calls ?? []
    if (!calls.length) { text = r.text; break }
    messages.push({ role: 'assistant', content: r.message.content ?? '', tool_calls: calls })
    for (const call of calls) {
      if (call.type !== 'function') continue
      onEvent({ type: 'tool', name: call.function.name, args: call.function.arguments })
      const result = await runner.run(call.function.name, call.function.arguments)
      ledger.add(result)
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  const bad = ledger.unsupported(text)
  return bad.length ? `${text}\n\n⚠ Not found in our data, please verify: ${bad.join(', ')}.` : text
}

export async function handleMessage(opts: Parameters<typeof handleMessageInner>[0]) {
  try {
    await handleMessageInner(opts)
  } catch (e) {
    // Keep the conversation readable: record that this request did not complete.
    await saveMessage(opts.session, currentWeek(), 'assistant', 'That request did not complete, so the plan is unchanged. Please try again.', opts.record.id).catch(() => {})
    throw e
  }
}

async function handleMessageInner(opts: {
  session: string
  record: PlanRecord
  message: string
  history: { role: string; content: string }[]
  onEvent: (e: AgentEvent | { type: 'reply'; text: string; record?: PlanRecord | null }) => void
}) {
  const { record, message, session, onEvent } = opts
  const week = currentWeek()
  await saveMessage(session, week, 'user', message, record.id)
  onEvent({ type: 'status', text: 'Reading your message (Nemotron Super)' })
  const routed = await complete({
    model: 'SUPER', endpoint: 'copilot-route', session, maxTokens: 250, json: true, temperature: 0,
    messages: [{ role: 'system', content: ROUTER },
               { role: 'user', content: `Current constraints: ${JSON.stringify(record.plan.constraints)}\nOfficer: ${message}` }],
  })
  let intent: Intent
  try { intent = parseJson<Intent>(routed.text) } catch { intent = { intent: 'question' } }

  if (intent.intent !== 'replan') {
    onEvent({ type: 'status', text: 'Looking up the data to answer' })
    const text = await answer(session, record, message, opts.history, onEvent)
    await saveMessage(session, week, 'assistant', text, record.id)
    onEvent({ type: 'reply', text })
    return
  }

  const before = record.plan.constraints ?? DEFAULT_CONSTRAINTS
  const constraints = mergeConstraints(before, intent)
  onEvent({ type: 'status', text: 'Re-planning with your constraints (escalating to Nemotron Ultra)' })
  const plan = await generatePlan({ session, constraints, previous: record.plan, instruction: message, onEvent })
  plan.changes = diffPlans(record.plan, plan)
  const saved = await savePlan(plan, 'app', session)
  const text = describeChanges(plan.changes, before, constraints)
  await saveMessage(session, week, 'assistant', text, saved.id)
  onEvent({ type: 'reply', text, record: await planById(saved.id) })
}
