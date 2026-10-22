/**
 * GET  /api/review?week=          -> computed weekly stats and repeat-offender flags (no model call)
 * POST /api/review { action: 'summary' | 'flags', week, refresh? } -> Super briefing / Nano flag explanations (cached)
 */
import { load } from './_lib/data.ts'
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { explainFlags, repeatOffenders, supervisorSummary, weekStats } from './_lib/review.ts'

const weekParam = (w: unknown) => (typeof w === 'string' && /^\d{4}-W\d{2}$/.test(w) ? w : load().meta.epi_week)

export const GET = handler(async (req) => {
  const week = weekParam(new URL(req.url).searchParams.get('week'))
  const [stats, offenders] = await Promise.all([weekStats(week), repeatOffenders()])
  return Response.json({ stats, offenders: offenders.slice(0, 40), offenders_total: offenders.length })
})

export const POST = handler(async (req) => {
  const body = await readJson<{ action?: string; week?: string; refresh?: boolean }>(req)
  const week = weekParam(body.week)
  const session = sessionId(req)
  const offenders = await repeatOffenders()
  if (body.action === 'summary') return Response.json(await supervisorSummary(session, await weekStats(week), offenders, Boolean(body.refresh)))
  if (body.action === 'flags') return Response.json({ explanations: await explainFlags(session, offenders, Boolean(body.refresh)) })
  throw new BadRequest('Unknown action')
})
