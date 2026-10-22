import { load } from './data.ts'
import { sql } from './db.ts'
import { nextCandidates, type Plan } from './planner.ts'

export interface PlanRecord { id: number; version: number; status: string; epi_week: string; created_at: string; confirmed_at: string | null; source: string; plan: Plan }

/** Latest plan version for the current epi week (the confirmed one if any), with chat history. */
export async function currentPlan() {
  const week = load().meta.epi_week
  const rows = (await sql()`select id, version, status, epi_week, created_at, confirmed_at, source, plan from plans
    where epi_week = ${week} order by (status = 'confirmed') desc, version desc limit 1`) as PlanRecord[]
  const messages = (await sql()`select role, content, plan_id, created_at from plan_messages
    where epi_week = ${week} order by id`) as { role: string; content: string; plan_id: number | null; created_at: string }[]
  const record = rows[0] ?? null
  return { epi_week: week, record, messages, candidates: record ? nextCandidates(record.plan) : [] }
}

export async function planById(id: number): Promise<PlanRecord | null> {
  const rows = (await sql()`select id, version, status, epi_week, created_at, confirmed_at, source, plan from plans where id = ${id}`) as PlanRecord[]
  return rows[0] ?? null
}
