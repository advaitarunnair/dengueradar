import { sql } from './db.ts'

/** Token use per UTC day and model, plus Ultra agent runs. Aggregates only: no session ids. */
export async function dailyUsage(days = 30) {
  return (await sql()`select date_trunc('day', at)::date::text as day, model,
      sum(prompt_tokens + completion_tokens)::int as tokens, count(*) filter (where endpoint <> 'agent-run')::int as calls,
      count(*) filter (where endpoint = 'agent-run')::int as agent_runs
    from llm_usage where at > now() - make_interval(days => ${days}) group by 1, 2 order by 1 desc, 3 desc`) as { day: string; model: string; tokens: number; calls: number; agent_runs: number }[]
}
