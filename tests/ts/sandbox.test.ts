/**
 * Runs the real SQL against an in-process Postgres (PGlite): no Neon, no model calls, no tokens.
 * Covers December judging: rolling demo data, the cold start, and visitors being isolated from each other.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import OpenAI, { APIConnectionTimeoutError, APIError } from 'openai'
import { useTestDb } from '../../api/_lib/db.ts'
import { ensureDemoData, generateDemoInspections, DEMO_WEEKS } from '../../api/_lib/demo.ts'
import { currentWeek, dateOverride, sgToday } from '../../api/_lib/epi.ts'
import { checklist, premisesWithHistory, saveInspection } from '../../api/_lib/inspect.ts'
import { complete, ModelBusyError, REQUEST_LIMITS, useTestClient } from '../../api/_lib/llm.ts'
import { confirmPlan, copyToSession, currentPlan, ensureCanonicalPlan, planById, resetSession, unconfirmPlan, visiblePlan } from '../../api/_lib/plans.ts'
import { savePlan, type Plan } from '../../api/_lib/planner.ts'
import { defaultReviewWeek, explainFlags, repeatOffenders, supervisorSummary, weekStats } from '../../api/_lib/review.ts'

process.env.DEMO_DATE = '2026-12-08'
delete process.env.VERCEL_ENV
const A = 'session-aaaa-1111', B = 'session-bbbb-2222'
const db = new PGlite()

/** Same call shapes as Neon's HTTP driver: a tagged template and .query(), both returning rows. */
const client = Object.assign(
  async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((t, s, i) => t + s + (i < values.length ? `$${i + 1}` : ''), '')
    return (await db.query(text, values)).rows
  },
  { query: async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows },
)

function fakePlan(week: string, teams = ['Team Alpha']): Plan {
  const stop = { premises_id: 1, code: 'x', name: 'Demo Blk 1', premises_type: 'hdb_block', subzone_id: 'x', lat: 1.3, lon: 103.8 }
  return {
    epi_week: week, generated_at: '2026-12-08T00:00:00Z', model: 'test', summary: 'Test plan.', areas: [], context: [],
    constraints: { teams, days: 5, per_day: 6, skip_subzones: [], skip_inspected_last_week: false, notes: [] },
    teams: teams.map((name) => ({ name, regions: ['WEST'], capacity: 30, premises: 1, subzone_ids: ['x'], days: [{ day: 1, stops: [stop], km: 0 }] })),
    outlook: { current_cases: 1, forecast_cases: 1, outlook: 'Stable', case_week: week, forecast_week: week },
    checks: { numbers_checked: 0, unsupported: [], dropped: [], replaced: [], removed_sentences: [] },
    agent: { tool_calls: [], tokens: 0, ms: 0 },
  }
}

await db.exec(readFileSync('db/schema.sql', 'utf8'))
useTestDb(client)
const seed = JSON.parse(readFileSync('db/demo_seed.json', 'utf8'))
await db.query(`insert into premises (code, name, premises_type, subzone_id, lat, lon, layout_notes, is_demo)
  select code, name, premises_type, subzone_id, lat, lon, layout_notes, true
  from jsonb_to_recordset($1::jsonb) as x(code text, name text, premises_type text, subzone_id text, lat float8, lon float8, layout_notes text)`, [JSON.stringify(seed.premises)])

test('the date override works in tests and previews, never in production', () => {
  assert.equal(sgToday(), '2026-12-08')
  assert.equal(currentWeek(), '2026-W49')
  process.env.VERCEL_ENV = 'production'
  assert.equal(dateOverride(), null)
  assert.notEqual(sgToday(), '2026-12-08')
  delete process.env.VERCEL_ENV
})

test('demo records are reproducible for a week and slide with it', () => {
  const premises = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, code: `C${i}`, premises_type: 'hdb_block', subzone_id: `s${i % 20}` }))
  const rank = () => 10
  const a = generateDemoInspections(premises, rank, '2026-W49', '2026-12-08')
  assert.deepEqual(a, generateDemoInspections(premises, rank, '2026-W49', '2026-12-08'))
  const weeks = new Set(a.map((r) => r.epi_week))
  assert.equal(weeks.size, DEMO_WEEKS)
  assert.ok(weeks.has('2026-W48') && !weeks.has('2026-W49'), 'covers complete weeks only')
  assert.ok(a.every((r) => r.inspected_on < '2026-12-06'), 'nothing dated in the current week')
  // A week seen from a later anchor keeps the same records apart from follow-up completion, which depends on today.
  const later = generateDemoInspections(premises, rank, '2026-W50', '2026-12-15')
  const strip = (r: typeof a[number]) => ({ ...r, follow_up_done: false })
  const w48 = (x: typeof a) => x.filter((r) => r.epi_week === '2026-W48').map(strip)
  assert.deepEqual(w48(a), w48(later))
})

test('as of 8 Dec, Review and Inspect data are populated and realistic', async () => {
  await ensureDemoData()
  const [{ n }] = (await db.query<{ n: number }>('select count(*)::int as n from inspections where is_demo')).rows
  assert.ok(n > 1000, `demo inspections: ${n}`)
  await ensureDemoData() // second call is a no-op
  const [{ n: again }] = (await db.query<{ n: number }>('select count(*)::int as n from inspections where is_demo')).rows
  assert.equal(again, n)
  const week = await defaultReviewWeek(A)
  assert.equal(week, '2026-W48', 'opens on the last complete week')
  const stats = await weekStats(week, A)
  const offenders = await repeatOffenders(A)
  console.log(`  W48: ${stats.this_week.inspections} inspections, ${stats.this_week.with_breeding} with breeding; last week ${stats.last_week.inspections}; overdue ${stats.overdue_follow_ups.total}; re-inspect ${stats.reinspect.length}; repeat sites ${offenders.length} (persistent ${offenders.filter((o) => o.level === 'persistent').length})`)
  assert.ok(stats.this_week.inspections > 100 && stats.this_week.with_breeding > 3)
  assert.ok(stats.last_week.inspections > 100)
  assert.ok(stats.overdue_follow_ups.total > 2 && stats.overdue_follow_ups.total < 120, `overdue ${stats.overdue_follow_ups.total}`)
  assert.ok(offenders.some((o) => o.level === 'persistent'), 'has persistent sites')
  assert.ok(offenders.length > 5 && offenders.length < 120, `repeat sites ${offenders.length}`)
})

test('a first-time visitor sees the canonical plan immediately', async () => {
  assert.equal((await currentPlan(A)).record, null)
  await savePlan(fakePlan('2026-W49'), 'scheduled_job', null, true)
  const state = await currentPlan(A)
  assert.equal(state.record?.is_canonical, true)
  assert.equal(state.stale, false)
  assert.equal(state.as_of, '2026-12-08')
  const r = await ensureCanonicalPlan()
  assert.equal(r.created, false, 'existing canonical plan means no model call')
})

test('two visitors can re-plan and confirm without affecting each other or the canonical plan', async () => {
  const canonical = (await visiblePlan(A))!
  const saved = await savePlan(fakePlan('2026-W49', ['Team Alpha', 'Team Bravo']), 'app', A)
  assert.equal((await visiblePlan(A))?.id, saved.id)
  assert.equal((await visiblePlan(B))?.id, canonical.id, 'B still sees canonical')
  await confirmPlan(canonical.id, B)
  const bPlan = (await visiblePlan(B))!
  assert.equal(bPlan.status, 'confirmed')
  assert.notEqual(bPlan.id, canonical.id, 'confirming copies into the sandbox')
  assert.equal((await planById(canonical.id))?.status, 'draft', 'canonical is untouched')
  assert.equal((await visiblePlan(A))?.status, 'draft', 'A is unaffected')
  const [{ n }] = (await db.query<{ n: number }>('select count(*)::int as n from assignments where plan_id = $1', [bPlan.id])).rows
  assert.equal(n, 1)
  await unconfirmPlan(canonical.id, A) // someone else's or shared plan: no effect
  assert.equal((await planById(canonical.id))?.status, 'draft')
})

test('saved reports are private to the visitor and counted in their review only', async () => {
  const before = await weekStats('2026-W49', B)
  const { id } = await saveInspection({
    premises_id: 1, team_name: 'Team Alpha', inspector: 'Test', notes_raw: 'x', session: A,
    report: { location: 'x', habitats: [{ type: 'gully trap', location: null, breeding: true, count: 2 }], breeding_found: true, actions_taken: '', follow_up_needed: true, follow_up_due: '2026-12-15', summary: '', missing: [] },
  })
  assert.ok(id)
  assert.equal((await weekStats('2026-W49', A)).this_week.inspections, before.this_week.inspections + 1)
  assert.equal((await weekStats('2026-W49', B)).this_week.inspections, before.this_week.inspections)
  const hist = async (s: string) => (await premisesWithHistory(1, s))!.history.filter((h) => !h.is_demo).length
  assert.equal(await hist(A), 1)
  assert.equal(await hist(B), 0)
})

test('Reset demo returns a visitor to the canonical state and leaves others alone', async () => {
  await resetSession(A)
  const a = await currentPlan(A)
  assert.equal(a.record?.is_canonical, true)
  assert.equal(a.messages.length, 0)
  assert.equal((await premisesWithHistory(1, A))!.history.filter((h) => !h.is_demo).length, 0)
  assert.equal((await visiblePlan(B))?.status, 'confirmed', 'B keeps their confirmed plan')
  const copy = await copyToSession((await visiblePlan(A))!, A)
  assert.equal(copy.session_id, A)
})

test('a stalled model gives up before the function limit and the labelled fallbacks show', async () => {
  const seen: { timeout: number; maxRetries: number }[] = []
  const stalled = { chat: { completions: { create: async (_: unknown, limits: { timeout: number; maxRetries: number }) => {
    seen.push(limits)
    throw new APIConnectionTimeoutError()
  } } } }
  useTestClient(stalled as unknown as OpenAI)
  try {
    const session = 'session-stall-3333'
    const ck = await checklist(session, 1, true)
    assert.ok(ck.items.length > 0, 'generic checklist still shows')
    assert.match(ck.notice ?? '', /didn’t respond in time.*generic checklist/)
    const week = await defaultReviewWeek(session)
    const offenders = await repeatOffenders(session)
    const brief = await supervisorSummary(session, await weekStats(week, session), offenders, true)
    assert.match(brief.notice ?? '', /didn’t respond in time/)
    assert.ok(brief.sections.length > 0, 'computed counts still show')
    assert.deepEqual(await explainFlags(session, offenders, true), {})
    assert.ok(seen.length >= 3)
    for (const { timeout, maxRetries } of Object.values(REQUEST_LIMITS).filter((l) => l !== REQUEST_LIMITS.ULTRA)) {
      assert.ok(timeout * (maxRetries + 1) < 100_000, 'every attempt fits inside the 120 s function limit')
    }
  } finally {
    useTestClient(null)
  }
})

test('a rejected request stays a real error, not a "try again" message', async () => {
  const rejected = { chat: { completions: { create: async () => { throw new APIError(400, undefined, 'bad request', new Headers()) } } } }
  useTestClient(rejected as unknown as OpenAI)
  try {
    await assert.rejects(complete({ model: 'NANO', endpoint: 'test', session: 'session-stall-4444', maxTokens: 1, messages: [] }),
      (e) => e instanceof APIError && !(e instanceof ModelBusyError))
  } finally {
    useTestClient(null)
  }
})
