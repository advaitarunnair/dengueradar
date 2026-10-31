/**
 * Called once a day by Vercel Cron (06:30 SGT, after the data refresh). Makes sure this week's demo window and
 * canonical plan exist. Generates at most once a week; every other call is a cheap no-op.
 */
import { ensureDemoData } from '../_lib/demo.ts'
import { handler } from '../_lib/http.ts'
import { ensureCanonicalPlan } from '../_lib/plans.ts'

export const GET = handler(async (req) => {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Not authorised' }, { status: 401 })
  await ensureDemoData()
  return Response.json(await ensureCanonicalPlan())
})
