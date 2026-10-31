/**
 * Review stage. Every count, trend and flag is computed in SQL; Super writes the supervisor's briefing from
 * those numbers and Nano writes the explanation for each repeat-offender flag. Inspection data is DEMO data
 * (plus any reports saved through the app).
 */
import { createHash } from 'node:crypto'
import { NumberLedger } from './checks.ts'
import { load } from './data.ts'
import { sql } from './db.ts'
import { currentWeek, previousEpiWeek, sgToday } from './epi.ts'
import { LimitError } from './guard.ts'
import { complete, parseJson } from './llm.ts'

const subzoneName = (id: string) => load().areas.find((a) => a.subzone_id === id)?.subzone ?? id

export async function weekStats(week: string, session: string) {
  const prev = previousEpiWeek(week)
  const db = sql()
  const today = sgToday()
  const totals = (await db`select epi_week, count(*)::int as inspections, count(*) filter (where breeding_found)::int as with_breeding,
      count(distinct premises_id)::int as premises
    from inspections where epi_week in (${week}, ${prev}) and (is_demo or session_id = ${session}) group by 1`) as { epi_week: string; inspections: number; with_breeding: number; premises: number }[]
  const t = (w: string) => totals.find((x) => x.epi_week === w) ?? { epi_week: w, inspections: 0, with_breeding: 0, premises: 0 }
  const habitats = (await db`select i.epi_week, h->>'type' as habitat, count(*)::int as breeding_sites
    from inspections i, jsonb_array_elements(i.habitats) h
    where i.epi_week in (${week}, ${prev}) and (h->>'breeding')::boolean and (i.is_demo or i.session_id = ${session}) group by 1, 2 order by 3 desc`) as { epi_week: string; habitat: string; breeding_sites: number }[]
  const teams = (await db`select coalesce(team_name, 'Unassigned') as team, count(*)::int as inspections, count(*) filter (where breeding_found)::int as with_breeding
    from inspections where epi_week = ${week} and (is_demo or session_id = ${session}) group by 1 order by 1`) as { team: string; inspections: number; with_breeding: number }[]
  const areas = (await db`select p.subzone_id, count(*) filter (where i.breeding_found)::int as with_breeding, count(*)::int as inspections
    from inspections i join premises p on p.id = i.premises_id where i.epi_week = ${week} and (i.is_demo or i.session_id = ${session})
    group by 1 having count(*) filter (where i.breeding_found) > 0 order by 2 desc, 3 desc limit 5`) as { subzone_id: string; with_breeding: number; inspections: number }[]
  const overdue = (await db`select i.id, p.name, p.subzone_id, i.follow_up_due::text as due, (${today}::date - i.follow_up_due)::int as days_overdue, i.team_name
    from inspections i join premises p on p.id = i.premises_id
    where i.follow_up_needed and not i.follow_up_done and i.follow_up_due < ${today}::date and (i.is_demo or i.session_id = ${session})
    order by i.follow_up_due limit 25`) as { id: number; name: string; subzone_id: string; due: string; days_overdue: number; team_name: string | null }[]
  const reinspect = (await db`select i.id, p.name, p.subzone_id, i.follow_up_due::text as due, i.team_name
    from inspections i join premises p on p.id = i.premises_id
    where i.epi_week = ${week} and (i.is_demo or i.session_id = ${session}) and i.breeding_found and i.follow_up_needed and not i.follow_up_done and (i.follow_up_due is null or i.follow_up_due >= ${today}::date)
    order by i.follow_up_due nulls last limit 25`) as { id: number; name: string; subzone_id: string; due: string | null; team_name: string | null }[]
  const [overdueCount] = (await db`select count(*)::int as n from inspections where follow_up_needed and not follow_up_done and follow_up_due < ${today}::date and (is_demo or session_id = ${session})`) as { n: number }[]
  return {
    week, previous_week: prev, today,
    this_week: t(week), last_week: t(prev),
    breeding_habitats: { this_week: habitats.filter((h) => h.epi_week === week).slice(0, 6), last_week: habitats.filter((h) => h.epi_week === prev).slice(0, 6) },
    teams,
    areas_with_breeding: areas.map((a) => ({ ...a, subzone: subzoneName(a.subzone_id) })),
    overdue_follow_ups: { total: overdueCount.n, oldest: overdue.map((o) => ({ ...o, subzone: subzoneName(o.subzone_id) })) },
    reinspect: reinspect.map((r) => ({ ...r, subzone: subzoneName(r.subzone_id) })),
  }
}
export type WeekStats = Awaited<ReturnType<typeof weekStats>>

/** Premises with breeding in 2+ different weeks of the last 8, or 2+ breeding habitats in one visit. */
export async function repeatOffenders(session: string) {
  const today = sgToday()
  const rows = (await sql()`
    with v as (
      select i.premises_id, i.epi_week, i.inspected_on, i.breeding_found,
             (select count(*) from jsonb_array_elements(i.habitats) h where (h->>'breeding')::boolean)::int as breeding_habitats,
             (select string_agg(distinct h->>'type', ', ') from jsonb_array_elements(i.habitats) h where (h->>'breeding')::boolean) as habitat_types
      from inspections i where i.inspected_on > ${today}::date - 56 and i.inspected_on <= ${today}::date and (i.is_demo or i.session_id = ${session}))
    select p.id as premises_id, p.name, p.premises_type, p.subzone_id,
           count(distinct v.epi_week) filter (where v.breeding_found)::int as weeks_with_breeding,
           array_agg(distinct v.epi_week) filter (where v.breeding_found) as breeding_weeks,
           max(v.breeding_habitats)::int as max_habitats_one_visit,
           string_agg(distinct v.habitat_types, '; ') as habitats,
           max(v.inspected_on) filter (where v.breeding_found)::text as last_breeding,
           count(*)::int as visits
    from v join premises p on p.id = v.premises_id
    group by p.id
    having count(distinct v.epi_week) filter (where v.breeding_found) >= 2 or max(v.breeding_habitats) >= 2
    order by 5 desc, 7 desc, 9 desc`) as {
      premises_id: number; name: string; premises_type: string; subzone_id: string; weeks_with_breeding: number; breeding_weeks: string[]
      max_habitats_one_visit: number; habitats: string | null; last_breeding: string; visits: number }[]
  return rows.map((r) => {
    const level = r.weeks_with_breeding >= 3 ? 'persistent' : r.weeks_with_breeding === 2 ? 'repeat' : 'multiple'
    const escalation = level === 'persistent'
      ? 'Escalate: supervisor review for enforcement under NEA procedures, and meet the owner or managing agent.'
      : level === 'repeat'
        ? 'Re-inspect within 7 days and issue a written advisory to the occupier or managing agent.'
        : 'Look for a structural cause (blocked drains, gutters) and refer to the town council or managing agent.'
    return { ...r, subzone: subzoneName(r.subzone_id), breeding_weeks: (r.breeding_weeks ?? []).sort(), level, escalation }
  })
}
export type Offender = Awaited<ReturnType<typeof repeatOffenders>>[number]

/** Review opens on the most recent complete week with data, not the current partial week. */
export async function defaultReviewWeek(session: string): Promise<string> {
  const current = currentWeek()
  const rows = (await sql()`select max(epi_week) as week from inspections where epi_week < ${current} and (is_demo or session_id = ${session})`) as { week: string | null }[]
  return rows[0]?.week ?? previousEpiWeek(current)
}

const hash = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12)

export async function supervisorSummary(session: string, stats: WeekStats, offenders: Offender[], refresh: boolean) {
  const facts = { ...stats, repeat_offenders: { total: offenders.length, persistent: offenders.filter((o) => o.level === 'persistent').length,
    top: offenders.slice(0, 5).map((o) => ({ name: o.name, subzone: o.subzone, weeks_with_breeding: o.weeks_with_breeding, level: o.level })) } }
  const key = `summary:${stats.week}:${hash(facts)}`
  const db = sql()
  if (!refresh) {
    const hit = (await db`select value from llm_cache where key = ${key}`) as { value: { sections: Section[]; removed: string[] } }[]
    if (hit.length) return { ...hit[0].value, cached: true }
  }
  let r: Awaited<ReturnType<typeof complete>>
  try {
    r = await complete({
    model: 'SUPER', endpoint: 'summary', session, maxTokens: 900, json: true, temperature: 0.2,
    messages: [
      { role: 'system', content: `You write the weekly dengue inspection briefing for an NEA supervisor in Singapore.
Use ONLY the numbers and names in the facts. Never calculate new numbers (no percentages, differences or totals that are not given). Compare this week with last week in words ("more", "fewer", "about the same").
Be concise and operational. Note that inspection data in this prototype is demo data only if you mention data sources.
Reply with ONLY JSON: {"sections": [{"title": "Headline", "points": ["..."]}, {"title": "Breeding found", "points": []}, {"title": "Trends vs last week", "points": []}, {"title": "Overdue actions", "points": []}, {"title": "Re-inspect next", "points": []}, {"title": "Repeat offenders", "points": []}]}
Each section has 1 to 4 short points.` },
      { role: 'user', content: JSON.stringify(facts) },
    ],
    })
  } catch (e) {
    if (e instanceof LimitError) return { ...numbersOnlyBriefing(stats, offenders), removed: [], cached: false, notice: e.message }
    throw e
  }
  const parsed = parseJson<{ sections: Section[] }>(r.text)
  const ledger = new NumberLedger()
  ledger.add(facts)
  const removed: string[] = []
  const sections = (parsed.sections ?? []).map((s) => ({
    title: String(s.title), points: (s.points ?? []).filter((p) => {
      const ok = !ledger.unsupported(String(p)).length
      if (!ok) removed.push(String(p))
      return ok
    }),
  })).filter((s) => s.points.length)
  const value = { sections, removed }
  await db`insert into llm_cache (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
           on conflict (key) do update set value = excluded.value, created_at = now()`
  return { ...value, cached: false }
}
interface Section { title: string; points: string[] }

/** Written by code from the computed counts, for when the AI budget is spent. */
function numbersOnlyBriefing(stats: WeekStats, offenders: Offender[]): { sections: Section[] } {
  const a = stats.this_week, b = stats.last_week
  return { sections: [
    { title: 'This week', points: [`${a.inspections} inspections, ${a.with_breeding} with breeding (last week: ${b.inspections} and ${b.with_breeding}).`] },
    { title: 'Actions', points: [`${stats.overdue_follow_ups.total} follow-ups overdue; ${stats.reinspect.length} sites to re-inspect.`] },
    { title: 'Repeat offenders', points: [`${offenders.length} sites flagged, ${offenders.filter((o) => o.level === 'persistent').length} persistent.`] },
  ] }
}

/** One Nano call explains all flags; cached per flag state. */
export async function explainFlags(session: string, offenders: Offender[], refresh: boolean): Promise<Record<number, string>> {
  const list = offenders.slice(0, 15)
  if (!list.length) return {}
  const key = `flags:${hash(list.map((o) => [o.premises_id, o.breeding_weeks, o.max_habitats_one_visit]))}`
  const db = sql()
  if (!refresh) {
    const hit = (await db`select value from llm_cache where key = ${key}`) as { value: Record<number, string> }[]
    if (hit.length) return hit[0].value
  }
  let r: Awaited<ReturnType<typeof complete>>
  try {
    r = await complete({
    model: 'NANO', endpoint: 'flags', session, maxTokens: 1200, json: true, temperature: 0.2,
    messages: [
      { role: 'system', content: `For each flagged premises, write one plain sentence (max 30 words) for an NEA supervisor explaining why it is flagged and what the pattern suggests.
Use only the given facts; copy numbers and weeks exactly; do not invent causes as facts (say "may" for possible causes).
Reply with ONLY JSON: {"explanations": [{"premises_id": 0, "text": ""}]}` },
      { role: 'user', content: JSON.stringify(list.map((o) => ({ premises_id: o.premises_id, name: o.name, type: o.premises_type, level: o.level,
        weeks_with_breeding: o.weeks_with_breeding, breeding_weeks: o.breeding_weeks, max_breeding_habitats_in_one_visit: o.max_habitats_one_visit, habitats: o.habitats }))) },
    ],
    })
  } catch (e) {
    if (e instanceof LimitError) return {} // the flags and fixed escalation steps still show without the explanations
    throw e
  }
  const out: Record<number, string> = {}
  for (const e of parseJson<{ explanations: { premises_id: number; text: string }[] }>(r.text).explanations ?? []) {
    const o = list.find((x) => x.premises_id === Number(e.premises_id))
    if (!o) continue
    const ledger = new NumberLedger()
    ledger.add(o)
    if (!ledger.unsupported(e.text).length) out[o.premises_id] = e.text
  }
  await db`insert into llm_cache (key, value) values (${key}, ${JSON.stringify(out)}::jsonb)
           on conflict (key) do update set value = excluded.value, created_at = now()`
  return out
}
