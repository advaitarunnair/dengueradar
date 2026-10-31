/** POST /api/session { action: 'reset' } -> "Reset demo": removes this visitor's plans, chat, reports and photos. */
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { resetSession } from './_lib/plans.ts'

export const POST = handler(async (req) => {
  const body = await readJson<{ action?: string }>(req)
  if (body.action !== 'reset') throw new BadRequest('Unknown action')
  await resetSession(sessionId(req))
  return Response.json({ ok: true })
})
