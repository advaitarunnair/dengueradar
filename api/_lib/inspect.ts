/**
 * Inspect stage: site checklists (Nano) and field notes -> structured service reports (Super, JSON mode).
 * All premises and inspection history are DEMO data.
 */
import { sql } from './db.ts'
import { epiWeekOf, sgToday } from './epi.ts'
import { complete, parseJson } from './llm.ts'

export const HABITATS = [
  'domestic container (pail, vase, flower pot plate)', 'discarded receptacle', 'gully trap', 'scupper drain or drain',
  'roof gutter', 'water tank', 'puddle or ground depression', 'bamboo pole holder', 'tree hole or plant axil',
  'ornamental container or pond', 'floor slab ponding (construction)', 'lift well or basement (construction)',
  'plastic sheet or tarpaulin', 'drum or container stack', 'other',
]

export interface Premises { id: number; code: string; name: string; premises_type: string; subzone_id: string; lat: number; lon: number; layout_notes: string | null; is_demo: boolean }
export interface InspectionRow {
  id: number; inspected_on: string; epi_week: string; team_name: string | null; inspector: string | null
  breeding_found: boolean; habitats: { type: string; location: string | null; breeding: boolean; count: number | null }[]
  actions_taken: string | null; follow_up_needed: boolean; follow_up_due: string | null; follow_up_done: boolean; is_demo: boolean
}

export async function premisesWithHistory(id: number) {
  const db = sql()
  const [p] = (await db`select * from premises where id = ${id}`) as Premises[]
  if (!p) return null
  const history = (await db`select id, inspected_on::text, epi_week, team_name, inspector, breeding_found, habitats, actions_taken,
      follow_up_needed, follow_up_due::text, follow_up_done, is_demo
    from inspections where premises_id = ${id} order by inspected_on desc, id desc limit 8`) as InspectionRow[]
  return { premises: p, history }
}

export interface ChecklistItem { habitat: string; check: string; priority: 'high' | 'normal'; why: string }

export async function checklist(session: string, premisesId: number, refresh = false): Promise<{ items: ChecklistItem[]; cached: boolean }> {
  const data = await premisesWithHistory(premisesId)
  if (!data) throw new Error('Premises not found')
  const db = sql()
  const key = `checklist:${premisesId}:${data.history[0]?.id ?? 0}`
  if (!refresh) {
    const hit = (await db`select value from llm_cache where key = ${key}`) as { value: { items: ChecklistItem[] } }[]
    if (hit.length) return { items: hit[0].value.items, cached: true }
  }
  const past = data.history.slice(0, 5).map((h) => ({
    date: h.inspected_on, breeding_found: h.breeding_found,
    habitats: h.habitats.map((x) => `${x.type}${x.breeding ? ' (breeding)' : ''}`),
  }))
  const r = await complete({
    model: 'NANO', endpoint: 'checklist', session, maxTokens: 900, json: true, temperature: 0.2,
    messages: [
      { role: 'system', content: `You write site inspection checklists for NEA dengue (Aedes) inspectors in Singapore.
Use NEA's breeding habitat categories: ${HABITATS.join('; ')}.
Tailor the list to the premises type and layout, and put first any habitat where breeding was found in past inspections.
Give 8 to 12 short, concrete items. "why" is at most 12 words; mention a past finding only if it is in the history given (quote its date exactly). Do not invent facts.
Reply with ONLY JSON: {"items": [{"habitat": "<category>", "check": "<what to look at and where>", "priority": "high" | "normal", "why": "<reason>"}]}` },
      { role: 'user', content: JSON.stringify({ premises_type: data.premises.premises_type, layout: data.premises.layout_notes, past_inspections: past }) },
    ],
  })
  // Any "why" that cites a past date must match the history: that date, that habitat, breeding if claimed.
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '')
  const items = (parseJson<{ items: ChecklistItem[] }>(r.text).items ?? []).slice(0, 14).map((it) => {
    const dates = it.why?.match(/\d{4}-\d{2}-\d{2}/g) ?? []
    if (!dates.length) return it
    const ok = dates.every((d) => data.history.some((h) => h.inspected_on === d && h.habitats.some((x) =>
      (norm(x.type).includes(norm(it.habitat)) || norm(it.habitat).includes(norm(x.type))) && (!/breed/i.test(it.why) || x.breeding))))
    return ok ? it : { ...it, why: 'Common habitat for this type of premises', priority: 'normal' as const }
  })
  await db`insert into llm_cache (key, value) values (${key}, ${JSON.stringify({ items })}::jsonb)
           on conflict (key) do update set value = excluded.value, created_at = now()`
  return { items, cached: false }
}

export interface ReportDraft {
  location: string
  habitats: { type: string; location: string | null; breeding: boolean; count: number | null }[]
  breeding_found: boolean
  actions_taken: string
  follow_up_needed: boolean
  follow_up_due: string | null
  summary: string
  missing: string[]
}

export async function draftReport(session: string, premisesId: number, notes: string, inspector: string | null): Promise<ReportDraft> {
  const data = await premisesWithHistory(premisesId)
  if (!data) throw new Error('Premises not found')
  const today = sgToday()
  const r = await complete({
    model: 'SUPER', endpoint: 'report', session, maxTokens: 900, json: true, temperature: 0.1,
    messages: [
      { role: 'system', content: `You turn an NEA dengue inspector's rough field notes (typed or dictated, possibly messy) into a formal service report.
Use ONLY what the notes say. Never invent habitats, counts, actions or dates.
actions_taken: only what the inspector actually did. Advice or instructions given to the occupier must be written as advice (e.g. "Advised occupier to tip flower pot plates"), never as if the inspector did it. If something is not in the notes, use null or an empty list and add the field name to "missing".
Map each habitat to the closest of these categories: ${HABITATS.join('; ')}.
"breeding" means larvae or pupae were found in that habitat. follow_up_needed is true if breeding was found or the notes ask for a revisit.
follow_up_due: a date (YYYY-MM-DD) only if the notes give one or a relative time ("in a week" = 7 days after ${today}); otherwise null.
summary: 1-2 formal sentences for the record.
Reply with ONLY JSON: {"location": "", "habitats": [{"type": "", "location": "", "breeding": false, "count": null}], "breeding_found": false, "actions_taken": "", "follow_up_needed": false, "follow_up_due": null, "summary": "", "missing": []}` },
      { role: 'user', content: JSON.stringify({ premises: data.premises.name, premises_type: data.premises.premises_type, date: today, inspector, notes }) },
    ],
  })
  const d = parseJson<ReportDraft>(r.text)
  const habitats = (d.habitats ?? []).map((h) => ({ type: String(h.type ?? 'other'), location: h.location ?? null, breeding: Boolean(h.breeding), count: Number.isFinite(Number(h.count)) && h.count !== null ? Number(h.count) : null }))
  return {
    location: d.location || data.premises.name, habitats,
    breeding_found: Boolean(d.breeding_found) || habitats.some((h) => h.breeding),
    actions_taken: d.actions_taken ?? '', follow_up_needed: Boolean(d.follow_up_needed) || habitats.some((h) => h.breeding),
    follow_up_due: /^\d{4}-\d{2}-\d{2}$/.test(String(d.follow_up_due)) ? d.follow_up_due : null,
    summary: d.summary ?? '', missing: Array.isArray(d.missing) ? d.missing : [],
  }
}

export async function saveInspection(input: {
  premises_id: number; team_name: string | null; inspector: string | null; notes_raw: string; report: ReportDraft
}): Promise<{ id: number }> {
  const today = sgToday()
  const r = input.report
  const [row] = (await sql()`insert into inspections (premises_id, inspected_on, epi_week, team_name, inspector, breeding_found, habitats,
      actions_taken, follow_up_needed, follow_up_due, notes_raw, report, is_demo)
    values (${input.premises_id}, ${today}, ${epiWeekOf(new Date(today))}, ${input.team_name}, ${input.inspector}, ${r.breeding_found},
      ${JSON.stringify(r.habitats)}::jsonb, ${r.actions_taken}, ${r.follow_up_needed}, ${r.follow_up_due}, ${input.notes_raw},
      ${JSON.stringify(r)}::jsonb, false)
    returning id`) as { id: number }[]
  return row
}
