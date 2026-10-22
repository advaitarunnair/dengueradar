/**
 * GET  /api/inspect                  -> the confirmed plan's teams, days and visits, with this week's status
 * GET  /api/inspect?premises=ID      -> premises details and inspection history
 * POST /api/inspect { action: 'checklist', premises_id, refresh? }            -> Nano site checklist (cached)
 * POST /api/inspect { action: 'draft', premises_id, notes, inspector }        -> Super structured report draft (not saved)
 * POST /api/inspect { action: 'save', premises_id, team_name, inspector, notes_raw, report } -> saves the edited report
 */
import { load } from './_lib/data.ts'
import { sql } from './_lib/db.ts'
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { checklist, draftReport, premisesWithHistory, saveInspection, type ReportDraft } from './_lib/inspect.ts'

export const GET = handler(async (req) => {
  const premisesId = new URL(req.url).searchParams.get('premises')
  if (premisesId) {
    const data = await premisesWithHistory(Number(premisesId))
    return data ? Response.json(data) : Response.json({ error: 'Premises not found' }, { status: 404 })
  }
  const week = load().meta.epi_week
  const db = sql()
  const [plan] = (await db`select id, version, confirmed_at from plans where epi_week = ${week} and status = 'confirmed' limit 1`) as { id: number; version: number; confirmed_at: string }[]
  if (!plan) return Response.json({ epi_week: week, plan: null, visits: [] })
  const visits = await db`
    select a.team_name, a.day, a.visit_order, a.subzone_id, p.id as premises_id, p.name, p.premises_type, p.lat, p.lon,
           (select i.id from inspections i where i.premises_id = p.id and i.epi_week = ${week} and not i.is_demo order by i.id desc limit 1) as report_id,
           (select i.breeding_found from inspections i where i.premises_id = p.id and i.epi_week = ${week} and not i.is_demo order by i.id desc limit 1) as breeding_found,
           (select count(*)::int from inspections i where i.premises_id = p.id and i.breeding_found and i.inspected_on > current_date - 56) as breeding_last_8_weeks
    from assignments a join premises p on p.id = a.premises_id
    where a.plan_id = ${plan.id} order by a.team_name, a.day, a.visit_order` as Record<string, unknown>[]
  const names = new Map(load().areas.map((a) => [a.subzone_id, a.subzone]))
  return Response.json({ epi_week: week, plan, visits: visits.map((v) => ({ ...v, subzone: names.get(v.subzone_id as string) ?? v.subzone_id })) })
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
        photo_ids: Array.isArray(body.photo_ids) ? body.photo_ids.map(Number).filter(Number.isFinite).slice(0, 20) : [],
      }))
    }
    default:
      throw new BadRequest('Unknown action')
  }
})
