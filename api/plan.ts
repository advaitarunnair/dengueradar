/**
 * GET  /api/plan          -> this week's cached plan (no model call); ?id= for a specific version
 * POST /api/plan          -> { action: 'generate' } runs the Ultra planning agent and streams its steps
 *                            { action: 'confirm' | 'unconfirm', id } locks a version and assigns visits to teams
 */
import { sessionId } from './_lib/guard.ts'
import { sql } from './_lib/db.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { DEFAULT_CONSTRAINTS, generatePlan, savePlan } from './_lib/planner.ts'
import { currentPlan, planById } from './_lib/plans.ts'
import { ndjson } from './_lib/stream.ts'

export const GET = handler(async (req) => {
  const id = new URL(req.url).searchParams.get('id')
  if (id) {
    const record = await planById(Number(id))
    return record ? Response.json({ record }) : Response.json({ error: 'Plan not found' }, { status: 404 })
  }
  return Response.json(await currentPlan())
})

async function confirm(id: number, on: boolean) {
  const record = await planById(id)
  if (!record) throw new BadRequest('Plan not found')
  const db = sql()
  if (!on) {
    await db`update plans set status = 'draft', confirmed_at = null where id = ${id}`
    await db`delete from assignments where plan_id = ${id}`
    return
  }
  await db`update plans set status = 'draft', confirmed_at = null where epi_week = ${record.epi_week} and id <> ${id}`
  await db`delete from assignments where plan_id in (select id from plans where epi_week = ${record.epi_week})`
  await db`update plans set status = 'confirmed', confirmed_at = now() where id = ${id}`
  const rows = record.plan.teams.flatMap((t) => t.days.flatMap((d) => d.stops.map((s, i) => ({
    team_name: t.name, subzone_id: s.subzone_id, premises_id: s.premises_id, day: d.day, visit_order: i + 1 }))))
  await db.query(`insert into assignments (plan_id, team_name, subzone_id, premises_id, day, visit_order)
    select $1, team_name, subzone_id, premises_id, day, visit_order
    from jsonb_to_recordset($2::jsonb) as x(team_name text, subzone_id text, premises_id int, day int, visit_order int)`, [id, JSON.stringify(rows)])
}

export const POST = handler(async (req) => {
  const body = await readJson<{ action?: string; id?: number }>(req)
  const session = sessionId(req)
  if (body.action === 'confirm' || body.action === 'unconfirm') {
    await confirm(Number(body.id), body.action === 'confirm')
    return Response.json(await currentPlan())
  }
  if (body.action !== 'generate') return Response.json({ error: 'Unknown action' }, { status: 400 })
  const { record } = await currentPlan()
  const constraints = record?.plan.constraints ?? DEFAULT_CONSTRAINTS
  return ndjson(async (send) => {
    const plan = await generatePlan({ session, constraints, onEvent: send })
    const saved = await savePlan(plan)
    send({ type: 'plan', record: await planById(saved.id) })
  })
})
