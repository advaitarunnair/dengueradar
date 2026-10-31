/** Types shared with the Copilot API (mirrors api/_lib/planner.ts). */
import type { Band } from './types'

export interface Stop { premises_id: number; code: string; name: string; premises_type: string; subzone_id: string; lat: number; lon: number }
export interface Constraints { teams: string[]; days: number; per_day: number; skip_subzones: string[]; skip_inspected_last_week: boolean; notes: string[] }
export interface PlanArea {
  order: number; subzone_id: string; subzone: string; planning_area: string; region: string
  rank: number; band: Band; risk: number; vulnerable: number
  clusters_within_1km: number; cluster_cases_within_1km: number; nearest_cluster_km: number | null
  premises: number; premises_total?: number; reason: string; focus: string; team: string; lat: number; lon: number
  factors?: string[]
}
export interface PlanTeam { name: string; regions: string[]; capacity: number; premises: number; subzone_ids: string[]; days: { day: number; stops: Stop[]; km: number }[] }
export interface Plan {
  epi_week: string; generated_at: string; model: string; constraints: Constraints
  summary: string; areas: PlanArea[]; teams: PlanTeam[]
  context: { id: string; title: string; url: string; published: string | null; note: string }[]
  context_queries?: { label: string; query: string; results: number }[]
  outlook: { current_cases: number; forecast_cases: number; outlook: string; case_week: string; forecast_week: string }
  checks: { numbers_checked: number; unsupported: number[]; dropped: { subzone_id: string; why: string }[]; removed_sentences?: string[]; corrections?: { where: string; removed: string }[]; rendered?: { subzone: string; factors: string[]; text: string }[] }
  agent: { tool_calls: { name: string; args: string }[]; tokens: number; ms: number }
  changes?: { added: string[]; removed: string[]; moved: { subzone: string; from: string; to: string }[] }
}
export interface PlanRecord { id: number; version: number; status: 'draft' | 'confirmed'; epi_week: string; created_at: string; confirmed_at: string | null; source: string; is_canonical?: boolean; session_id?: string | null; plan: Plan }
export interface PlanState {
  epi_week: string
  record: PlanRecord | null
  messages: { role: 'user' | 'assistant'; content: string; plan_id: number | null; created_at: string }[]
  candidates: { subzone_id: string; subzone: string; rank: number; band: Band }[]
  /** The plan shown is from an earlier week because this week's has not been drafted yet. */
  stale?: boolean
  /** Set only on test deployments running with a date override. */
  as_of?: string | null
}

/** Categorical colours for teams (validated palette slots 1 to 3), always shown with the team name. */
export const TEAM_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7', '#e87ba4']
export const teamColor = (plan: Plan, team: string) => TEAM_COLORS[Math.max(0, plan.constraints.teams.indexOf(team)) % TEAM_COLORS.length]

export function describeTool(name: string, args: string): string {
  let a: Record<string, unknown> = {}
  try { a = JSON.parse(args) } catch { /* show the name only */ }
  switch (name) {
    case 'rank_areas': return `Looked up the top ${a.top_n ?? 20} priority subzones${a.region ? ` in ${a.region}` : ''}`
    case 'get_area_risk': return `Checked the risk breakdown for ${String(a.area ?? '').replace(/-/g, ' ')}`
    case 'get_area_history': return `Checked rank and inspection history for ${String(a.area ?? '').replace(/-/g, ' ')}`
    case 'search_recent_context':
    case 'search_news': return `Searched recent news: “${a.query ?? ''}”`
    default: return name
  }
}

export const PREMISES_TYPE: Record<string, string> = {
  hdb_block: 'HDB block', landed_home: 'Landed homes', condo: 'Condominium', construction_site: 'Construction site',
  school: 'School', market: 'Market / food centre', park: 'Park',
}
export interface Visit {
  team_name: string; day: number; visit_order: number; subzone_id: string; subzone: string; premises_id: number; name: string; premises_type: string
  lat: number; lon: number; report_id: number | null; breeding_found: boolean | null; breeding_last_8_weeks: number
}
export interface VisitsState { epi_week: string; plan: { id: number; version: number; confirmed_at: string | null; confirmed: boolean; canonical: boolean } | null; visits: Visit[] }
export interface Habitat { type: string; location: string | null; breeding: boolean; count: number | null }
export interface Inspection {
  id: number; inspected_on: string; epi_week: string; team_name: string | null; inspector: string | null; breeding_found: boolean
  habitats: Habitat[]; actions_taken: string | null; follow_up_needed: boolean; follow_up_due: string | null; follow_up_done: boolean; is_demo: boolean
}
export interface PremisesDetail {
  premises: { id: number; code: string; name: string; premises_type: string; subzone_id: string; lat: number; lon: number; layout_notes: string | null; is_demo: boolean }
  history: Inspection[]
}
export interface ChecklistItem { habitat: string; check: string; priority: 'high' | 'normal'; why: string }
export interface ReportDraft {
  location: string; habitats: Habitat[]; breeding_found: boolean; actions_taken: string
  follow_up_needed: boolean; follow_up_due: string | null; summary: string; missing: string[]
}
export const HABITAT_TYPES = [
  'domestic container (pail, vase, flower pot plate)', 'discarded receptacle', 'gully trap', 'scupper drain or drain',
  'roof gutter', 'water tank', 'puddle or ground depression', 'bamboo pole holder', 'tree hole or plant axil',
  'ornamental container or pond', 'floor slab ponding (construction)', 'lift well or basement (construction)',
  'plastic sheet or tarpaulin', 'drum or container stack', 'other',
]

export interface WeekTotals { epi_week: string; inspections: number; with_breeding: number; premises: number }
export interface ReviewStats {
  week: string; previous_week: string; today: string; this_week: WeekTotals; last_week: WeekTotals
  breeding_habitats: { this_week: { habitat: string; breeding_sites: number }[]; last_week: { habitat: string; breeding_sites: number }[] }
  teams: { team: string; inspections: number; with_breeding: number }[]
  areas_with_breeding: { subzone_id: string; subzone: string; with_breeding: number; inspections: number }[]
  overdue_follow_ups: { total: number; oldest: { id: number; name: string; subzone: string; due: string; days_overdue: number; team_name: string | null }[] }
  reinspect: { id: number; name: string; subzone: string; due: string | null; team_name: string | null }[]
}
export interface Offender {
  premises_id: number; name: string; premises_type: string; subzone_id: string; subzone: string; weeks_with_breeding: number
  breeding_weeks: string[]; max_habitats_one_visit: number; habitats: string | null; last_breeding: string; visits: number
  level: 'persistent' | 'repeat' | 'multiple'; escalation: string; habitat_actions?: string[]
}
export interface ReviewState { stats: ReviewStats; offenders: Offender[]; offenders_total: number; default_week: string; current_week: string }
export interface Briefing { sections: { title: string; points: string[] }[]; removed: string[]; cached: boolean; notice?: string }
