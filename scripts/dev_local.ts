/**
 * Local test server: the real /api handlers on an in-process, throwaway Postgres (PGlite), so nothing touches
 * Neon. Model calls are real and spend credits. Usage: DEMO_DATE=2026-12-08 tsx scripts/dev_local.ts
 * Then run the web app with API_PROXY=http://localhost:3001 VERCEL=1 npm run dev --prefix web
 */
import './env.ts'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { useTestDb } from '../api/_lib/db.ts'

delete process.env.DATABASE_URL
delete process.env.VERCEL_ENV
process.env.CRON_SECRET = 'local-test'
const db = new PGlite()
await db.exec(readFileSync('db/schema.sql', 'utf8'))
useTestDb(Object.assign(
  async (strings: TemplateStringsArray, ...values: unknown[]) => (await db.query(strings.reduce((t, s, i) => t + s + (i < values.length ? `$${i + 1}` : ''), ''), values)).rows,
  { query: async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows },
))
const seed = JSON.parse(readFileSync('db/demo_seed.json', 'utf8'))
await db.query(`insert into premises (code, name, premises_type, subzone_id, lat, lon, layout_notes, is_demo)
  select code, name, premises_type, subzone_id, lat, lon, layout_notes, true
  from jsonb_to_recordset($1::jsonb) as x(code text, name text, premises_type text, subzone_id text, lat float8, lon float8, layout_notes text)`, [JSON.stringify(seed.premises)])

const ROUTES: Record<string, string> = {
  plan: '../api/plan.ts', copilot: '../api/copilot.ts', inspect: '../api/inspect.ts', review: '../api/review.ts',
  photos: '../api/photos.ts', session: '../api/session.ts', usage: '../api/usage.ts', health: '../api/health.ts', 'cron/weekly-plan': '../api/cron/weekly-plan.ts',
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost:3001')
  const name = url.pathname.replace(/^\/api\//, '')
  const mod = ROUTES[name] ? await import(ROUTES[name]) : null
  const fn = mod?.[req.method ?? 'GET']
  if (!fn) { res.writeHead(404).end('{"error":"not found"}'); return }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
  const r: Response = await fn(new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }))
  res.writeHead(r.status, Object.fromEntries(r.headers))
  if (r.body) for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) res.write(c)
  res.end()
}).listen(3001, () => console.log(`Local API on :3001 with a throwaway database${process.env.DEMO_DATE ? `, as of ${process.env.DEMO_DATE}` : ''}`))
