/**
 * Credit safety for a public site backed by a paid API key:
 * a global daily token cap, plus per-session hourly call limits (tighter for Ultra).
 */
import { createHash } from 'node:crypto'
import { sql } from './db.ts'

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

/** Daily token cap and per-session hourly call limit, checked before every model call. */
export async function checkBudget(session: string): Promise<void> {
  const db = sql()
  const [row] = (await db`
    select
      coalesce(sum(prompt_tokens + completion_tokens) filter (where at >= date_trunc('day', now() at time zone 'utc')), 0)::int as day_tokens,
      count(*) filter (where session_id = ${session} and at > now() - interval '1 hour' and endpoint <> 'agent-run')::int as session_calls
    from llm_usage where at > now() - interval '1 day'`) as { day_tokens: number; session_calls: number }[]
  if (row.day_tokens >= num('DAILY_TOKEN_CAP', 400_000))
    throw new LimitError('The daily AI budget for this demo has been used up. Cached plans and reports still work; new AI requests resume tomorrow (UTC).')
  if (row.session_calls >= num('SESSION_CALLS_PER_HOUR', 40))
    throw new LimitError('Too many AI requests from this session in the last hour. Please try again shortly.')
}

/** Ultra agent runs (plan generation and re-planning) are limited per session per hour, counted per run. */
export async function startAgentRun(session: string): Promise<void> {
  const [row] = (await sql()`select count(*)::int as runs from llm_usage
    where session_id = ${session} and endpoint = 'agent-run' and at > now() - interval '1 hour'`) as { runs: number }[]
  if (row.runs >= num('SESSION_ULTRA_CALLS_PER_HOUR', 6))
    throw new LimitError('Plan generation is limited to a few runs per hour per session. Please try again later, or ask the copilot a question instead.')
  await recordUsage(session, 'nvidia/Nemotron-3-Ultra-550b-a55b', 'agent-run', 0, 0)
}

export async function recordUsage(session: string, model: string, endpoint: string, prompt: number, completion: number) {
  await sql()`insert into llm_usage (session_id, model, endpoint, prompt_tokens, completion_tokens)
              values (${session}, ${model}, ${endpoint}, ${prompt}, ${completion})`
}
