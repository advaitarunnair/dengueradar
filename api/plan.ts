/**
 * GET  /api/plan   -> this week's cached plan (no model call)
 * POST /api/plan   -> { action: 'generate' } runs the Ultra planning agent and streams its steps
 */
import { sessionId } from './_lib/guard.ts'
import { handler, readJson } from './_lib/http.ts'
import { DEFAULT_CONSTRAINTS, generatePlan, savePlan } from './_lib/planner.ts'
import { currentPlan, planById } from './_lib/plans.ts'
import { ndjson } from './_lib/stream.ts'

export const GET = handler(async () => Response.json(await currentPlan()))

export const POST = handler(async (req) => {
  const body = await readJson<{ action?: string }>(req)
  const session = sessionId(req)
  if (body.action !== 'generate') return Response.json({ error: 'Unknown action' }, { status: 400 })
  const { record } = await currentPlan()
  const constraints = record?.plan.constraints ?? DEFAULT_CONSTRAINTS
  return ndjson(async (send) => {
    const plan = await generatePlan({ session, constraints, onEvent: send })
    const saved = await savePlan(plan)
    send({ type: 'plan', record: await planById(saved.id) })
  })
})
