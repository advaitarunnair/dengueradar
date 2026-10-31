/**
 * Credit safety for a public site backed by a paid API key, sized so 15 days of judging cannot exhaust
 * credits: a global daily token cap and Ultra run cap, per-session and per-IP hourly limits. The scheduled
 * weekly plan (a system session) is exempt: it runs once a week and visitors must not be able to block it.
 * Check spend with GET /api/usage or `npm run usage`.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { sql } from './db.ts'

export const SYSTEM_SESSION = 'system-weekly-plan'
const context = new AsyncLocalStorage<{ ip: string }>()

/** Run a request with its hashed IP available to the usage log and per-IP limit. */
export function withRequestContext<T>(req: Request, fn: () => Promise<T>): Promise<T> {
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  return context.run({ ip: createHash('sha256').update(ip).digest('hex').slice(0, 16) }, fn)
}

export class LimitError extends Error {
  status = 429
}

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback) || fallback

/** Session id from the browser (x-session-id), falling back to a hash of the caller's IP. */
export function sessionId(req: Request): string {
  const header = req.headers.get('x-session-id') ?? ''
  if (/^[a-zA-Z0-9-]{8,64}$/.test(header)) return header
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  return 'ip-' + createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

/** Daily token cap, then per-session and per-IP hourly limits, checked before every model call. */
export async function checkBudget(session: string): Promise<void> {
  if (session === SYSTEM_SESSION) return
  const ip = context.getStore()?.ip ?? 'none'
  const [row] = (await sql()`
    select
      coalesce(sum(prompt_tokens + completion_tokens) filter (where at >= date_trunc('day', now() at time zone 'utc')), 0)::int as day_tokens,
      count(*) filter (where session_id = ${session} and at > now() - interval '1 hour' and endpoint <> 'agent-run')::int as session_calls,
      count(*) filter (where ip_hash = ${ip} and at > now() - interval '1 hour' and endpoint <> 'agent-run')::int as ip_calls
    from llm_usage where at > now() - interval '1 day'`) as { day_tokens: number; session_calls: number; ip_calls: number }[]
  if (row.day_tokens >= num('DAILY_TOKEN_CAP', 200_000))
    throw new LimitError('Today’s AI budget for this demo has been used up, so you’re seeing saved results. New AI requests resume at 08:00 Singapore time.')
  if (row.session_calls >= num('SESSION_CALLS_PER_HOUR', 30) || (ip !== 'none' && row.ip_calls >= num('IP_CALLS_PER_HOUR', 90)))
    throw new LimitError('That’s a lot of AI requests in the last hour, so you’re seeing saved results. Please try again shortly.')
}

/** Ultra agent runs are limited per session per hour and globally per day, counted per run. */
export async function startAgentRun(session: string): Promise<void> {
  if (session !== SYSTEM_SESSION) {
    const [row] = (await sql()`select
        count(*) filter (where session_id = ${session} and at > now() - interval '1 hour')::int as session_runs,
        count(*) filter (where session_id <> ${SYSTEM_SESSION} and at >= date_trunc('day', now() at time zone 'utc'))::int as day_runs
      from llm_usage where endpoint = 'agent-run' and at > now() - interval '1 day'`) as { session_runs: number; day_runs: number }[]
    if (row.session_runs >= num('SESSION_ULTRA_CALLS_PER_HOUR', 3))
      throw new LimitError('Re-planning is limited to a few runs an hour per visitor, so your current plan stays as it is. You can still ask the copilot questions.')
    if (row.day_runs >= num('DAILY_ULTRA_RUNS', 6))
      throw new LimitError('Today’s re-planning budget for this demo has been used up, so your current plan stays as it is. It resumes at 08:00 Singapore time.')
  }
  await recordUsage(session, 'nvidia/Nemotron-3-Ultra-550b-a55b', 'agent-run', 0, 0)
}

export async function recordUsage(session: string, model: string, endpoint: string, prompt: number, completion: number) {
  await sql()`insert into llm_usage (session_id, model, endpoint, prompt_tokens, completion_tokens, ip_hash)
              values (${session}, ${model}, ${endpoint}, ${prompt}, ${completion}, ${context.getStore()?.ip ?? null})`
}
