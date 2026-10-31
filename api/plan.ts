/**
 * GET  /api/plan          -> this week's cached plan (no model call); ?id= for a specific version
 * POST /api/plan          -> { action: 'generate' } runs the Ultra planning agent and streams its steps
 *                            { action: 'confirm' | 'unconfirm', id } locks a version and assigns visits, for this visitor only
 */
import { sessionId } from './_lib/guard.ts'
import { handler, readJson } from './_lib/http.ts'
import { DEFAULT_CONSTRAINTS, generatePlan, savePlan } from './_lib/planner.ts'
import { confirmPlan, currentPlan, planById, unconfirmPlan } from './_lib/plans.ts'
import { ndjson } from './_lib/stream.ts'

export const GET = handler(async (req) => {
  const id = new URL(req.url).searchParams.get('id')
  if (id) {
    const record = await planById(Number(id))
    return record ? Response.json({ record }) : Response.json({ error: 'Plan not found' }, { status: 404 })
  }
  return Response.json(await currentPlan(sessionId(req)))
})

export const POST = handler(async (req) => {
  const body = await readJson<{ action?: string; id?: number; reset?: boolean }>(req)
  const session = sessionId(req)
  if (body.action === 'confirm' || body.action === 'unconfirm') {
    if (body.action === 'confirm') await confirmPlan(Number(body.id), session)
    else await unconfirmPlan(Number(body.id), session)
    return Response.json(await currentPlan(session))
  }
  if (body.action !== 'generate') return Response.json({ error: 'Unknown action' }, { status: 400 })
  const { record } = await currentPlan(session)
  // Regenerate keeps the officer's current constraints unless they ask to reset them.
  const constraints = body.reset ? DEFAULT_CONSTRAINTS : record?.plan.constraints ?? DEFAULT_CONSTRAINTS
  return ndjson(async (send) => {
    const plan = await generatePlan({ session, constraints, onEvent: send })
    const saved = await savePlan(plan, 'app', session)
    send({ type: 'plan', record: await planById(saved.id) })
  })
})
