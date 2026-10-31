/** Tavily search for recent Singapore dengue and weather context. Every query is cached per epi week. */
import { sql } from './db.ts'
import { currentWeek } from './epi.ts'

export interface Source { title: string; url: string; snippet: string; published: string | null }

const DOMAINS = ['nea.gov.sg', 'moh.gov.sg', 'cda.gov.sg', 'channelnewsasia.com', 'straitstimes.com', 'weather.gov.sg']
/** Index pages with no content of their own. */
const GENERIC_TITLE = /^(news|advisories|faqs?|home|the national environment agency)$/i
const MIN_SCORE = 0.4

async function search(query: string, range: 'week' | 'month' | 'year'): Promise<Source[]> {
  if (!process.env.TAVILY_API_KEY) return []
  const key = `tavily:${currentWeek()}:${range}:${query.toLowerCase()}`
  const db = sql()
  const hit = (await db`select value from llm_cache where key = ${key}`) as { value: Source[] }[]
  if (hit.length) return hit[0].value
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, topic: 'general', time_range: range, include_domains: DOMAINS, max_results: 6, search_depth: 'basic' }),
  })
  if (!r.ok) throw new Error(`Tavily search failed: HTTP ${r.status}`)
  const body = (await r.json()) as { results: { title: string; url: string; content: string; score?: number; published_date?: string }[] }
  const seen = new Set<string>()
  const sources = body.results
    .filter((x) => x.title && x.url && !GENERIC_TITLE.test(x.title.trim()) && (x.score ?? 1) >= MIN_SCORE)
    .filter((x) => !seen.has(x.title) && seen.add(x.title))
    .slice(0, 3)
    .map((x) => ({ title: x.title.trim(), url: x.url, snippet: x.content.slice(0, 400), published: x.published_date ?? null }))
  await db`insert into llm_cache (key, value) values (${key}, ${JSON.stringify(sources)}::jsonb)
           on conflict (key) do update set value = excluded.value, created_at = now()`
  return sources
}

/** The planner's targeted searches: one failed search never stops a plan. */
export async function gatherContext(planningAreas: string[]) {
  const areas = planningAreas.map((a) => a.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())).join(' ')
  const targeted: { label: string; query: string; range: 'month' | 'year' }[] = [
    { label: 'NEA dengue updates', query: 'dengue clusters cases Singapore NEA update', range: 'month' },
    { label: 'Dengue serotype shift', query: 'dengue serotype shift Singapore DENV', range: 'year' },
    { label: 'Weather and rainfall advisories', query: 'Singapore rainfall weather advisory MSS fortnightly outlook', range: 'month' },
    { label: `Local news: ${areas}`, query: `dengue ${areas} cluster Singapore`, range: 'month' },
  ]
  const sources: (Source & { id: string })[] = []
  const queries: { label: string; query: string; results: number }[] = []
  for (const t of targeted) {
    let found: Source[] = []
    try { found = await search(t.query, t.range) } catch (e) { console.error(e) }
    queries.push({ label: t.label, query: t.query, results: found.length })
    for (const s of found) if (!sources.some((x) => x.url === s.url)) sources.push({ ...s, id: `S${sources.length + 1}` })
  }
  return { queries, sources }
}

/** On-demand search for the agent tools. */
export const searchRecentContext = (query: string): Promise<Source[]> => search(/singapore/i.test(query) ? query : `Singapore ${query}`, 'year')
