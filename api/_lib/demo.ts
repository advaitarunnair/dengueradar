/**
 * Rolling DEMO inspection history: fictional records for the 8 complete weeks before the current epi week, so
 * Review and Inspect stay populated whenever someone visits. Each premises/week pair has its own seeded random
 * stream, so a week's records are reproducible and the window simply slides forward. Premises are fixed rows in
 * the premises table. Real rankings, clusters and forecasts are never touched by this.
 */
import { load } from './data.ts'
import { sql } from './db.ts'
import { currentWeek, epiWeekOf, epiWeekStart, sgToday } from './epi.ts'

export const DEMO_WEEKS = 8
const REPEAT_SITES = 12

const BREEDING_P: Record<string, number> = { hdb_block: 0.05, landed_home: 0.08, condo: 0.04, construction_site: 0.15, school: 0.03, market: 0.06, park: 0.05 }
const HABITATS: Record<string, string[]> = {
  hdb_block: ['flower pot plate', 'pail', 'bamboo pole holder', 'scupper drain', 'gully trap', 'roof gutter', 'discarded receptacle'],
  landed_home: ['flower pot plate', 'roof gutter', 'gully trap', 'ornamental container', 'pail', 'discarded receptacle'],
  condo: ['planter box', 'gully trap', 'roof gutter', 'puddle', 'ornamental container'],
  construction_site: ['floor slab ponding', 'lift well', 'pail', 'plastic sheet', 'open trench', 'drum', 'discarded receptacle'],
  school: ['roof gutter', 'puddle', 'tree hole', 'gully trap', 'discarded receptacle'],
  market: ['drain', 'crate', 'gully trap', 'discarded receptacle', 'puddle'],
  park: ['tree hole', 'puddle', 'drain', 'roof gutter', 'discarded receptacle'],
}
const TEAMS = ['Team Alpha', 'Team Bravo', 'Team Charlie']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Small seeded generator (mulberry32). */
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000)

export interface DemoPremises { id: number; code: string; premises_type: string; subzone_id: string }
export interface DemoInspection {
  premises_id: number; inspected_on: string; epi_week: string; team_name: string; inspector: string; breeding_found: boolean
  habitats: { type: string; location: null; breeding: boolean; count: number }[]; actions_taken: string
  follow_up_needed: boolean; follow_up_due: string | null; follow_up_done: boolean
}

/** Pure: the demo records for the window ending the week before `anchorWeek`, as of `today`. */
export function generateDemoInspections(premises: DemoPremises[], rankOf: (subzone: string) => number, anchorWeek: string, today: string): DemoInspection[] {
  const start = epiWeekStart(anchorWeek)
  const weeks = Array.from({ length: DEMO_WEEKS }, (_, k) => addDays(start, -7 * (DEMO_WEEKS - k)))
  const candidates = premises.filter((p) => rankOf(p.subzone_id) <= 60).sort((a, b) => hash(a.code) - hash(b.code))
  const repeat = new Set(candidates.slice(0, REPEAT_SITES).map((p) => p.code))
  const todayDate = new Date(today)
  const out: DemoInspection[] = []
  for (const p of premises) {
    const r = rankOf(p.subzone_id)
    const visitP = repeat.has(p.code) ? 0.75 : r <= 40 ? 0.45 : r <= 100 ? 0.25 : 0.08
    for (const sunday of weeks) {
      const label = epiWeekOf(sunday)
      const rand = rng(hash(`${p.code}|${label}`))
      if (rand() > visitP) continue
      const day = addDays(sunday, 1 + Math.floor(rand() * 5)) // Monday to Friday
      const breeding = rand() < (repeat.has(p.code) ? 0.55 : BREEDING_P[p.premises_type] ?? 0.05)
      const options = [...(HABITATS[p.premises_type] ?? HABITATS.hdb_block)]
      const n = 1 + Math.floor(rand() * 3)
      const habitats = Array.from({ length: Math.min(n, options.length) }, (_, i) => ({
        type: options.splice(Math.floor(rand() * options.length), 1)[0], location: null,
        breeding: breeding && i === 0, count: 1 + Math.floor(rand() * 4),
      }))
      if (breeding && habitats.length > 1 && rand() < 0.3) habitats[1].breeding = true
      const due = breeding ? addDays(day, 7) : null
      out.push({
        premises_id: p.id, inspected_on: iso(day), epi_week: label, team_name: TEAMS[Math.floor(rand() * TEAMS.length)],
        inspector: `Demo Inspector ${1 + Math.floor(rand() * 6)}`, breeding_found: breeding, habitats,
        actions_taken: breeding ? 'Larvae destroyed and habitat removed; larvicide applied; advisory left with occupier.' : 'Potential habitats checked and cleared; no breeding found.',
        follow_up_needed: breeding, follow_up_due: due ? iso(due) : null,
        follow_up_done: Boolean(due && due.getTime() < addDays(todayDate, -1).getTime() && rand() < 0.9),
      })
    }
  }
  return out
}

/** Slide the demo window when the epi week changes. Cheap to call on every read: no model use, one query. */
export async function ensureDemoData(): Promise<void> {
  const week = currentWeek()
  const db = sql()
  // Atomic claim: only one caller regenerates for a new week.
  const claimed = (await db`insert into llm_cache (key, value) values ('demo:anchor', ${JSON.stringify({ week })}::jsonb)
    on conflict (key) do update set value = excluded.value, created_at = now()
    where llm_cache.value->>'week' is distinct from ${week} returning key`) as unknown[]
  if (!claimed.length) return
  const premises = (await db`select id, code, premises_type, subzone_id from premises where is_demo`) as DemoPremises[]
  const ranks = new Map(load().areas.map((a) => [a.subzone_id, a.rank ?? 999]))
  const rows = generateDemoInspections(premises, (s) => ranks.get(s) ?? 999, week, sgToday())
  await db.query(
    `with gone as (delete from inspections where is_demo)
     insert into inspections (premises_id, inspected_on, epi_week, team_name, inspector, breeding_found, habitats, actions_taken,
                              follow_up_needed, follow_up_due, follow_up_done, is_demo)
     select x.premises_id, x.inspected_on, x.epi_week, x.team_name, x.inspector, x.breeding_found, x.habitats, x.actions_taken,
            x.follow_up_needed, x.follow_up_due, x.follow_up_done, true
     from jsonb_to_recordset($1::jsonb) as x(premises_id int, inspected_on date, epi_week text, team_name text, inspector text,
          breeding_found bool, habitats jsonb, actions_taken text, follow_up_needed bool, follow_up_due date, follow_up_done bool)`,
    [JSON.stringify(rows)],
  )
}
