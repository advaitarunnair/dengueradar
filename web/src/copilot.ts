/** Types shared with the Copilot API (mirrors api/_lib/planner.ts). */
import type { Band } from './types'

export interface Stop { premises_id: number; code: string; name: string; premises_type: string; subzone_id: string; lat: number; lon: number }
export interface Constraints { teams: string[]; days: number; per_day: number; skip_subzones: string[]; skip_inspected_last_week: boolean; notes: string[] }
export interface PlanArea {
  order: number; subzone_id: string; subzone: string; planning_area: string; region: string
  rank: number; band: Band; risk: number; vulnerable: number
  clusters_within_1km: number; cluster_cases_within_1km: number; nearest_cluster_km: number | null
  premises: number; reason: string; focus: string; team: string; lat: number; lon: number
  reason_source?: 'agent' | 'data'
}
export interface PlanTeam { name: string; regions: string[]; capacity: number; premises: number; subzone_ids: string[]; days: { day: number; stops: Stop[]; km: number }[] }
export interface Plan {
  epi_week: string; generated_at: string; model: string; constraints: Constraints
  summary: string; areas: PlanArea[]; teams: PlanTeam[]
  context: { id: string; title: string; url: string; published: string | null; note: string }[]
  outlook: { current_cases: number; forecast_cases: number; outlook: string; case_week: string; forecast_week: string }
  checks: { numbers_checked: number; unsupported: number[]; dropped: { subzone_id: string; why: string }[]; replaced?: { subzone: string; numbers: number[] }[] }
  agent: { tool_calls: { name: string; args: string }[]; tokens: number; ms: number }
  changes?: { added: string[]; removed: string[]; moved: { subzone: string; from: string; to: string }[] }
}
export interface PlanRecord { id: number; version: number; status: 'draft' | 'confirmed'; epi_week: string; created_at: string; confirmed_at: string | null; source: string; plan: Plan }
export interface PlanState {
  epi_week: string
  record: PlanRecord | null
  messages: { role: 'user' | 'assistant'; content: string; plan_id: number | null; created_at: string }[]
  candidates: { subzone_id: string; subzone: string; rank: number; band: Band }[]
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
    case 'search_recent_context': return `Searched recent news: “${a.query ?? ''}”`
    default: return name
  }
}
