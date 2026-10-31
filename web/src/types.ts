import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

export type Outlook = 'Rising' | 'Stable' | 'Falling'
export type Band = 'High' | 'Elevated' | 'Low'
export interface RankingConfig {
  cluster_scaling: 'log' | 'percentile'
  override_km: number
  override_cases: number | null
  priority_risk_exponent: number
  priority_population_exponent: number
  sort: 'band_first' | 'priority'
}
export type Component = 'spread' | 'rain' | 'temp'
export type Weights = Record<Component, number>

export interface SubzoneProps {
  subzone_id: string
  subzone: string
  planning_area: string
  region: string
  residents: number
  age65plus: number
  under15: number
  vulnerable: number
  eligible: boolean
  spread: number | null
  rain: number | null
  temp: number | null
  spread_raw: number
  rain_mm: number
  temp_c: number
  rain_mm_station: string
  temp_c_station: string
  clusters_within_1km: number
  cluster_cases_within_1km: number
  nearest_cluster_km: number | null
  max_cluster_cases_near?: number
  /** A large cluster is this close, so the subzone is High and listed first. */
  cluster_override?: boolean
  risk: number | null
  priority: number | null
  band: Band | null
  risk_rank: number | null
  rank: number | null
  rank_change: number | null
  is_new_in_top20: boolean
  reason: string
}

export type SubzoneFeature = Feature<Polygon | MultiPolygon, SubzoneProps>
export type ScoresCollection = FeatureCollection<Polygon | MultiPolygon, SubzoneProps>

export interface ClusterProps {
  locality: string
  cases: number
}
export type ClustersCollection = FeatureCollection<Polygon | MultiPolygon, ClusterProps>

export interface Driver {
  label: string
  value: string
  direction: 'up' | 'down'
  contribution: number
  text: string
}

export interface DataSource {
  name: string
  agency: string
  url: string
  licence: string
}

export interface Meta {
  generated_at: string
  epi_week: string
  current_cases: number
  case_week: string
  forecast_cases: number
  forecast_week: string
  pct_change: number
  outlook: Outlook
  drivers: Driver[]
  outlook_threshold_pct: number
  active_clusters: number
  cluster_cases: number
  clusters: {
    source: 'nea_map' | 'data_gov_sg'
    source_name: string
    source_url: string
    /** The source's own last-updated time, not when we fetched it. */
    updated_at: string | null
    fallback_used: boolean
    note: string | null
  }
  population_reference_year: number
  case_data: {
    last_week: string
    bulletin_last_week: string
    recent_source: string
    nea_fetch_ok: boolean
    manual_topup_used: boolean
  }
  weather: {
    window_end: string
    rain_stations_with_data: number
    rain_max_missing_share: number
    rain_window_days: number
    rain_stations_skipped: { id: string; name: string; missing_days: number }[]
    rain_stations_no_data: number
    temp_stations_with_data: number
    changi_source: string
    forecast_weather_features_missing: number
  }
  scoring: {
    weights: Weights
    bands: Record<Outlook, { high: number; elevated: number }>
    ranking?: RankingConfig
    min_residents: number
    decay_km: number
    eligible_subzones: number
    total_subzones: number
  }
  previous_week: string | null
  sources: DataSource[]
}

export interface MetricRow {
  n: number
  mae: number
  mape: number
  direction_accuracy: number | null
}
export type ModelName = 'model' | 'persistence' | 'seasonal'

export interface ModelEval {
  generated_at: string
  horizon_weeks: number
  algorithm: string
  target: string
  train: { first_target_week: string; last_target_week: string; n_weeks: number; validation_weeks: number }
  test: { first_target_week: string; last_target_week: string; n_weeks: number }
  outbreak_threshold_cases: number
  case_sources: { moh_bulletin: [string, string]; nea_page: [string, string] | null }
  metrics: Record<'all_test_weeks' | 'outbreak_weeks', Record<ModelName, MetricRow>>
  features: { name: string; label: string }[]
}

export interface ForecastPoint {
  epi_week: string
  actual: number
  model: number
  persistence: number
  seasonal: number | null
}

export interface FeatureImportance {
  label: string
  importance: number
}

/** A subzone after scoring in the browser with the current weights. */
export interface ScoredSubzone {
  props: SubzoneProps
  risk: number
  priority: number
  band: Band
  rank: number
}
