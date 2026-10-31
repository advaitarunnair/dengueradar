/** GET /api/usage -> daily token totals by model, so spend can be checked during judging. */
import { handler } from './_lib/http.ts'
import { dailyUsage } from './_lib/usage.ts'

export const GET = handler(async () => {
  const rows = await dailyUsage()
  const days = [...new Set(rows.map((r) => r.day))].map((day) => ({ day, tokens: rows.filter((r) => r.day === day).reduce((t, r) => t + r.tokens, 0) }))
  return Response.json({ cap_per_day: Number(process.env.DAILY_TOKEN_CAP ?? 200_000), days, by_model: rows })
})
