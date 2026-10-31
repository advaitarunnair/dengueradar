/** POST /api/copilot { message, plan_id } -> streams the copilot's steps and reply (and a new plan if it re-planned). */
import { handleMessage } from './_lib/copilot.ts'
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { canUse, currentPlan, planById } from './_lib/plans.ts'
import { ndjson } from './_lib/stream.ts'

export const POST = handler(async (req) => {
  const body = await readJson<{ message?: string; plan_id?: number }>(req)
  const message = (body.message ?? '').trim().slice(0, 600)
  if (!message) throw new BadRequest('Type a question or a change to the plan.')
  const session = sessionId(req)
  const { messages, record: visible } = await currentPlan(session)
  const requested = body.plan_id ? await planById(Number(body.plan_id)) : null
  const record = requested && canUse(requested, session) ? requested : visible
  if (!record) throw new BadRequest('Generate this week’s plan first.')
  if (record.status === 'confirmed') throw new BadRequest('This plan is confirmed. Unconfirm it to make changes.')
  return ndjson((send) => handleMessage({ session, record, message, history: messages, onEvent: send }))
})
