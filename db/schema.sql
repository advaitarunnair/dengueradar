-- DengueRadar Copilot schema (Neon Postgres). Safe to re-run.

-- Premises an inspection team can visit. Demo rows are fictional premises placed inside real subzones.
CREATE TABLE IF NOT EXISTS premises (
  id            serial PRIMARY KEY,
  code          text UNIQUE NOT NULL,
  name          text NOT NULL,
  premises_type text NOT NULL,         -- hdb_block, landed_home, condo, construction_site, school, market, park
  subzone_id    text NOT NULL,
  lat           double precision NOT NULL,
  lon           double precision NOT NULL,
  layout_notes  text,
  is_demo       boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS premises_subzone ON premises (subzone_id);

-- Weekly plans: every generation or re-plan is a new version; one version per week can be confirmed.
CREATE TABLE IF NOT EXISTS plans (
  id           serial PRIMARY KEY,
  epi_week     text NOT NULL,
  version      int NOT NULL,
  status       text NOT NULL DEFAULT 'draft',   -- draft, confirmed
  plan         jsonb NOT NULL,                  -- areas, reasons, teams, context, checks
  constraints  jsonb NOT NULL DEFAULT '{}'::jsonb,
  model        text NOT NULL,
  source       text NOT NULL DEFAULT 'app',     -- app, scheduled_job
  created_at   timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (epi_week, version)
);

CREATE TABLE IF NOT EXISTS plan_messages (
  id         serial PRIMARY KEY,
  epi_week   text NOT NULL,
  role       text NOT NULL,                     -- user, assistant
  content    text NOT NULL,
  plan_id    int REFERENCES plans(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Confirmed visits: team, area, premises and visiting order.
CREATE TABLE IF NOT EXISTS assignments (
  id          serial PRIMARY KEY,
  plan_id     int NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  team_name   text NOT NULL,
  subzone_id  text NOT NULL,
  premises_id int NOT NULL REFERENCES premises(id),
  day         int NOT NULL,
  visit_order int NOT NULL
);
CREATE INDEX IF NOT EXISTS assignments_plan ON assignments (plan_id);

-- Inspection service reports.
CREATE TABLE IF NOT EXISTS inspections (
  id               serial PRIMARY KEY,
  premises_id      int NOT NULL REFERENCES premises(id),
  inspected_on     date NOT NULL,
  epi_week         text NOT NULL,
  team_name        text,
  inspector        text,
  breeding_found   boolean NOT NULL,
  habitats         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{type, location, breeding, count}]
  actions_taken    text,
  follow_up_needed boolean NOT NULL DEFAULT false,
  follow_up_due    date,
  follow_up_done   boolean NOT NULL DEFAULT false,
  notes_raw        text,
  report           jsonb,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspections_premises ON inspections (premises_id, inspected_on);
CREATE INDEX IF NOT EXISTS inspections_week ON inspections (epi_week);

-- Photo evidence: a browser-resized JPEG plus the vision model's classification.
CREATE TABLE IF NOT EXISTS photos (
  id            serial PRIMARY KEY,
  inspection_id int REFERENCES inspections(id) ON DELETE SET NULL,
  premises_id   int NOT NULL REFERENCES premises(id),
  taken_at      timestamptz NOT NULL DEFAULT now(),
  lat           double precision,
  lon           double precision,
  mime          text NOT NULL,
  data          bytea NOT NULL,
  label         text,          -- container, puddle, drain, other
  is_clear      boolean,
  model_note    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Cached model outputs (checklists, summaries, flag explanations).
CREATE TABLE IF NOT EXISTS llm_cache (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every model call, for the daily token cap and per-session rate limits.
CREATE TABLE IF NOT EXISTS llm_usage (
  id                serial PRIMARY KEY,
  at                timestamptz NOT NULL DEFAULT now(),
  session_id        text NOT NULL,
  model             text NOT NULL,
  endpoint          text NOT NULL,
  prompt_tokens     int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS llm_usage_at ON llm_usage (at);
CREATE INDEX IF NOT EXISTS llm_usage_session ON llm_usage (session_id, at);
