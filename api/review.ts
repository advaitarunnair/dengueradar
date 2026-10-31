/**
 * GET  /api/review?week=          -> computed weekly stats and repeat-offender flags (no model call);
 *                                     without a week: the most recent complete week with data
 * POST /api/review { action: 'summary' | 'flags', week, refresh? } -> Super briefing / Nano flag explanations (cached)
 */
import { ensureDemoData } from './_lib/demo.ts'
import { currentWeek } from './_lib/epi.ts'
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { defaultReviewWeek, explainFlags, repeatOffenders, supervisorSummary, weekStats } from './_lib/review.ts'

const validWeek = (w: unknown) => (typeof w === 'string' && /^\d{4}-W\d{2}$/.test(w) ? w : null)

export const GET = handler(async (req) => {
  const session = sessionId(req)
  await ensureDemoData()
  const defaultWeek = await defaultReviewWeek(session)
  const week = validWeek(new URL(req.url).searchParams.get('week')) ?? defaultWeek
  const [stats, offenders] = await Promise.all([weekStats(week, session), repeatOffenders(session)])
  return Response.json({ stats, offenders: offenders.slice(0, 40), offenders_total: offenders.length, default_week: defaultWeek, current_week: currentWeek() })
})

export const POST = handler(async (req) => {
  const body = await readJson<{ action?: string; week?: string; refresh?: boolean }>(req)
  const session = sessionId(req)
  const week = validWeek(body.week) ?? await defaultReviewWeek(session)
  const offenders = await repeatOffenders(session)
  if (body.action === 'summary') return Response.json(await supervisorSummary(session, await weekStats(week, session), offenders, Boolean(body.refresh)))
  if (body.action === 'flags') return Response.json({ explanations: await explainFlags(session, offenders, Boolean(body.refresh)) })
  throw new BadRequest('Unknown action')
})
