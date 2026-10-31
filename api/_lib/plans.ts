import { currentWeek, dateOverride, sgToday } from './epi.ts'
import { sql } from './db.ts'
import { DEFAULT_CONSTRAINTS, generatePlan, nextCandidates, savePlan, type Plan } from './planner.ts'
import { SYSTEM_SESSION } from './guard.ts'

export interface PlanRecord {
  id: number; version: number; status: string; epi_week: string; created_at: string; confirmed_at: string | null
  source: string; is_canonical: boolean; session_id: string | null; plan: Plan
}

/**
 * The plan a visitor sees, in order: their own latest version this week (a confirmed one first), else this
 * week's canonical plan, else the newest canonical plan from an earlier week (flagged as stale), else any
 * pre-sandbox plan for this week. Other visitors' versions are never visible.
 */
export async function visiblePlan(session: string, week = currentWeek()): Promise<PlanRecord | null> {
  const db = sql()
  const mine = (await db`select id, version, status, epi_week, created_at, confirmed_at, source, is_canonical, session_id, plan from plans
    where epi_week = ${week} and session_id = ${session} order by (status = 'confirmed') desc, id desc limit 1`) as PlanRecord[]
  if (mine[0]) return mine[0]
  const canonical = (await db`select id, version, status, epi_week, created_at, confirmed_at, source, is_canonical, session_id, plan from plans
    where is_canonical and epi_week <= ${week} order by epi_week desc limit 1`) as PlanRecord[]
  if (canonical[0]?.epi_week === week) return canonical[0]
  const legacy = (await db`select id, version, status, epi_week, created_at, confirmed_at, source, is_canonical, session_id, plan from plans
    where epi_week = ${week} and session_id is null order by version desc limit 1`) as PlanRecord[]
  return legacy[0] ?? canonical[0] ?? null
}

export async function currentPlan(session: string) {
  const week = currentWeek()
  const record = await visiblePlan(session, week)
  const messages = (await sql()`select role, content, plan_id, created_at from plan_messages
    where epi_week = ${week} and session_id = ${session} order by id`) as { role: string; content: string; plan_id: number | null; created_at: string }[]
  return {
    epi_week: week, record, messages, candidates: record ? nextCandidates(record.plan) : [],
    stale: Boolean(record && record.epi_week !== week), as_of: dateOverride(), today: sgToday(),
  }
}

export async function planById(id: number): Promise<PlanRecord | null> {
  const rows = (await sql()`select id, version, status, epi_week, created_at, confirmed_at, source, is_canonical, session_id, plan from plans where id = ${id}`) as PlanRecord[]
  return rows[0] ?? null
}

/** A plan this session may act on: its own, or a shared (canonical or pre-sandbox) one. */
export const canUse = (record: PlanRecord, session: string) => record.session_id === null || record.session_id === session

/** Copy a shared plan into the visitor's sandbox so confirming or changing it affects only them. */
export async function copyToSession(record: PlanRecord, session: string): Promise<PlanRecord> {
  if (record.session_id === session) return record
  const week = currentWeek()
  const [row] = (await sql()`insert into plans (epi_week, version, status, plan, constraints, model, source, session_id)
    values (${week}, ${record.version}, 'draft', ${JSON.stringify({ ...record.plan, epi_week: week })}::jsonb, ${JSON.stringify(record.plan.constraints)}::jsonb,
            ${record.plan.model}, 'visitor_copy', ${session}) returning id`) as { id: number }[]
  return (await planById(row.id))!
}

/** Confirm a plan for this visitor only: writes their team assignments. */
export async function confirmPlan(id: number, session: string): Promise<void> {
  const shared = await planById(id)
  if (!shared || !canUse(shared, session)) throw new Error('Plan not found')
  const record = await copyToSession(shared, session)
  const db = sql()
  await db`update plans set status = 'draft', confirmed_at = null where epi_week = ${record.epi_week} and session_id = ${session} and id <> ${record.id}`
  await db`delete from assignments where plan_id in (select id from plans where epi_week = ${record.epi_week} and session_id = ${session})`
  await db`update plans set status = 'confirmed', confirmed_at = now() where id = ${record.id}`
  const rows = record.plan.teams.flatMap((t) => t.days.flatMap((d) => d.stops.map((s, i) => ({
    team_name: t.name, subzone_id: s.subzone_id, premises_id: s.premises_id, day: d.day, visit_order: i + 1 }))))
  await db.query(`insert into assignments (plan_id, team_name, subzone_id, premises_id, day, visit_order)
    select $1, team_name, subzone_id, premises_id, day, visit_order
    from jsonb_to_recordset($2::jsonb) as x(team_name text, subzone_id text, premises_id int, day int, visit_order int)`, [record.id, JSON.stringify(rows)])
}

export async function unconfirmPlan(id: number, session: string): Promise<void> {
  const db = sql()
  await db`delete from assignments where plan_id in (select id from plans where id = ${id} and session_id = ${session})`
  await db`update plans set status = 'draft', confirmed_at = null where id = ${id} and session_id = ${session}`
}

/** Back to the canonical state: removes only this visitor's own rows. */
export async function resetSession(session: string): Promise<void> {
  const db = sql()
  await db`delete from photos where session_id = ${session}`
  await db`delete from inspections where session_id = ${session}`
  await db`delete from plan_messages where session_id = ${session}`
  await db`delete from plans where session_id = ${session}`
}

/**
 * Make sure this week's canonical plan exists: generated once, cached, then a no-op, so visits never spend
 * tokens on it. A claim row stops two simultaneous callers generating twice; a stale claim can be retried.
 */
export async function ensureCanonicalPlan(): Promise<{ week: string; created: boolean; id?: number }> {
  const week = currentWeek()
  const db = sql()
  const existing = (await db`select id from plans where epi_week = ${week} and is_canonical`) as { id: number }[]
  if (existing[0]) return { week, created: false, id: existing[0].id }
  const key = `canonical-claim:${week}`
  const claimed = (await db`insert into llm_cache (key, value) values (${key}, '{}'::jsonb)
    on conflict (key) do update set created_at = now() where llm_cache.created_at < now() - interval '10 minutes' returning key`) as unknown[]
  if (!claimed.length) return { week, created: false }
  const plan = await generatePlan({ session: SYSTEM_SESSION, constraints: DEFAULT_CONSTRAINTS })
  const saved = await savePlan(plan, 'scheduled_job', null, true)
  return { week, created: true, id: saved.id }
}
