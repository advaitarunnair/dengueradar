/** Tavily news search for recent Singapore dengue / weather context. Results are cached for 12 hours. */
import { sql } from './db.ts'

export interface Source { title: string; url: string; snippet: string; published: string | null }

/** Social media and video pages are dropped: the agent should cite news and official sources. */
const BLOCKED = /(^|\.)(instagram|facebook|tiktok|x|twitter|reddit|youtube|threads|linkedin)\.com$/i

export async function searchRecentContext(query: string): Promise<Source[]> {
  if (!process.env.TAVILY_API_KEY) return []
  const q = /singapore/i.test(query) ? query : `Singapore ${query}`
  const key = `tavily:${q.toLowerCase()}`
  const db = sql()
  const hit = (await db`select value from llm_cache where key = ${key} and created_at > now() - interval '12 hours'`) as { value: Source[] }[]
  if (hit.length) return hit[0].value
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query: q, topic: 'news', days: 30, max_results: 8, search_depth: 'basic' }),
  })
  if (!r.ok) throw new Error(`Tavily search failed: HTTP ${r.status}`)
  const body = (await r.json()) as { results: { title: string; url: string; content: string; published_date?: string }[] }
  const seen = new Set<string>()
  const sources = body.results
    .filter((x) => x.title && x.url && !BLOCKED.test(new URL(x.url).hostname))
    .filter((x) => !seen.has(x.url) && seen.add(x.url))
    .slice(0, 5)
    .map((x) => ({ title: x.title.trim(), url: x.url, snippet: x.content.slice(0, 400), published: x.published_date ?? null }))
  await db`insert into llm_cache (key, value) values (${key}, ${JSON.stringify(sources)}::jsonb)
           on conflict (key) do update set value = excluded.value, created_at = now()`
  return sources
}
