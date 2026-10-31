/**
 * GET  /api/inspect                  -> the visitor's plan as visits by team and day, with this week's status
 * GET  /api/inspect?premises=ID      -> premises details and inspection history
 * POST /api/inspect { action: 'checklist', premises_id, refresh? }            -> Nano site checklist (cached)
 * POST /api/inspect { action: 'draft', premises_id, notes, inspector }        -> Super structured report draft (not saved)
 * POST /api/inspect { action: 'save', premises_id, team_name, inspector, notes_raw, report } -> saves the edited report
 */
import { load } from './_lib/data.ts'
import { sql } from './_lib/db.ts'
import { ensureDemoData } from './_lib/demo.ts'
import { currentWeek, sgToday } from './_lib/epi.ts'
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { checklist, draftReport, premisesWithHistory, saveInspection, type ReportDraft } from './_lib/inspect.ts'
import { visiblePlan } from './_lib/plans.ts'

export const GET = handler(async (req) => {
  const session = sessionId(req)
  await ensureDemoData()
  const premisesId = new URL(req.url).searchParams.get('premises')
  if (premisesId) {
    const data = await premisesWithHistory(Number(premisesId), session)
    return data ? Response.json(data) : Response.json({ error: 'Premises not found' }, { status: 404 })
  }
  // Visits come straight from the visitor's plan, so a first-time visitor can start on the canonical plan at once.
  const week = currentWeek()
  const record = await visiblePlan(session, week)
  if (!record) return Response.json({ epi_week: week, plan: null, visits: [] })
  const stops = record.plan.teams.flatMap((t) => t.days.flatMap((d) => d.stops.map((s, i) => ({ ...s, team_name: t.name, day: d.day, visit_order: i + 1 }))))
  const ids = stops.map((s) => s.premises_id)
  const db = sql()
  const reports = (await db`select distinct on (premises_id) premises_id, id, breeding_found from inspections
    where premises_id = any(${ids}) and epi_week = ${week} and session_id = ${session} order by premises_id, id desc`) as { premises_id: number; id: number; breeding_found: boolean }[]
  const breeding = (await db`select premises_id, count(*)::int as n from inspections
    where premises_id = any(${ids}) and breeding_found and inspected_on > ${sgToday()}::date - 56 and (is_demo or session_id = ${session}) group by 1`) as { premises_id: number; n: number }[]
  const names = new Map(load().areas.map((a) => [a.subzone_id, a.subzone]))
  return Response.json({
    epi_week: week,
    plan: { id: record.id, version: record.version, confirmed_at: record.confirmed_at, confirmed: record.status === 'confirmed', canonical: record.session_id === null },
    visits: stops.map((s) => {
      const r = reports.find((x) => x.premises_id === s.premises_id)
      return { ...s, subzone: names.get(s.subzone_id) ?? s.subzone_id, report_id: r?.id ?? null, breeding_found: r?.breeding_found ?? null,
               breeding_last_8_weeks: breeding.find((x) => x.premises_id === s.premises_id)?.n ?? 0 }
    }),
  })
})

export const POST = handler(async (req) => {
  const body = await readJson<Record<string, unknown>>(req)
  const session = sessionId(req)
  const premisesId = Number(body.premises_id)
  if (!premisesId) throw new BadRequest('premises_id is required')
  switch (body.action) {
    case 'checklist':
      return Response.json(await checklist(session, premisesId, Boolean(body.refresh)))
    case 'draft': {
      const notes = String(body.notes ?? '').trim().slice(0, 3000)
      if (notes.length < 5) throw new BadRequest('Add some field notes first.')
      return Response.json(await draftReport(session, premisesId, notes, body.inspector ? String(body.inspector).slice(0, 80) : null))
    }
    case 'save': {
      const report = body.report as ReportDraft
      if (!report || !Array.isArray(report.habitats)) throw new BadRequest('A report is required')
      return Response.json(await saveInspection({
        premises_id: premisesId, team_name: body.team_name ? String(body.team_name) : null,
        inspector: body.inspector ? String(body.inspector).slice(0, 80) : null, notes_raw: String(body.notes_raw ?? '').slice(0, 3000), report,
        photo_ids: Array.isArray(body.photo_ids) ? body.photo_ids.map(Number).filter(Number.isFinite).slice(0, 20) : [], session,
      }))
    }
    default:
      throw new BadRequest('Unknown action')
  }
})
