# DengueRadar Copilot

Student hackathon prototype (not an official NEA tool). An AI agent (NVIDIA Nemotron on Nebius Token Factory)
that runs a dengue inspection team's week: Plan / Inspect / Review. Built on DengueRadar's daily-refreshed
subzone risk ranking and island-wide LightGBM forecast. Hosted on Vercel (static `web/` + serverless `api/`),
Neon Postgres for state. Live: https://dengueradar.vercel.app

## Copilot (TypeScript, `api/`)
- `api/_lib/llm.ts` Token Factory client, model IDs (ULTRA/SUPER/NANO/VL), `complete()` = budget check + usage log + `<think>` strip.
  Reasoning is OFF by default (`enable_thinking: false`); Ultra with reasoning on invented tools in testing.
- `api/_lib/guard.ts` daily token cap + per-session limits (`llm_usage` table). Every model call must go through `complete()`.
- `api/_lib/planner.ts` two-phase plan agent: Ultra researches with `tools.ts`, then decides in JSON from a code-built candidate table.
  Code enforces capacity, team regions (no cross-island detours), routing (`routing.ts`) and number checks (`checks.ts`).
- `api/_lib/copilot.ts` Super routes questions vs re-plans; `inspect.ts` checklists (Nano) and reports (Super); `review.ts` SQL stats,
  briefing (Super), repeat offenders (SQL + Nano); `photos.ts` VL classification.
- Endpoints: `api/plan.ts`, `api/copilot.ts`, `api/inspect.ts`, `api/review.ts`, `api/photos.ts`, `api/health.ts`.
- `db/schema.sql` (run `npm run db:migrate`); demo data: `scripts/make_demo_data.py` -> `db/demo_seed.json` -> `npm run db:seed-demo`.
- Local: `vercel dev` (reads `.env` only, so `DATABASE_URL` must be copied there from `.env.local`). `npm run check:nebius`.
- Rule: any number an LLM writes must be verifiable against data passed to it; unverifiable text is removed or flagged, never shown silently.
- Rule: premises and inspection history are DEMO data and must stay labelled as such in the UI.

## Layout
- `scripts/common.py` HTTP client (cache, retry, backoff), data.gov.sg helpers, epi weeks, case and weather loaders
- `scripts/download_static.py` run once: subzone boundaries + SingStat population -> `data/subzone_population.csv`, `web/public/data/subzones.geojson`
- `scripts/train_model.py` run once: train + evaluate -> `models/forecast.joblib`, `web/public/data/{model_eval,forecast_test,feature_importance}.json`
- `scripts/build_scores.py` weekly job -> `web/public/data/{scores.geojson,clusters.geojson,meta.json}`, `data/history/YYYY-WW.json`
- `web/` React + Vite + TypeScript + Tailwind, HashRouter, base `/` on Vercel; static data from `web/public/data`, Copilot via `/api`
- `scripts/ranking_check.py` early check of the ranking vs new clusters (`data/history/cluster_log.json`, `ranking_check.json`)
- `config.yaml` verified dataset IDs/URLs, scoring weights, thresholds

## Commands
```
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/download_static.py
.venv/bin/python scripts/train_model.py
.venv/bin/python scripts/build_scores.py
.venv/bin/pytest -q
cd web && npm install && npm run dev      # npm run build to type-check and bundle
```
On macOS without Homebrew, LightGBM cannot find `libomp.dylib`. Fix used on the original dev machine: copy
scikit-learn's bundled `sklearn/.dylibs/libomp.dylib` next to `lightgbm/lib/lib_lightgbm.dylib`, then
`install_name_tool -add_rpath @loader_path` and `codesign -f -s -` on `lib_lightgbm.dylib`. CI (Linux) needs nothing.

- `scripts/realtime_weather.py` daily station rain/temperature from the data.gov.sg real-time APIs, cached per day in `data/cache/weather`

## Conventions and rules
- Never ship fabricated or simulated data. If a source fails, the job must fail loudly, not invent values.
- No leakage: `build_features` may only use shifts >= 0. `tests/test_model.py` enforces this.
- Evaluation is time-based and always reported next to persistence and seasonal-naive baselines.
- Dataset IDs/URLs go in `config.yaml` only after being confirmed through the API.
- Epi weeks are Sunday to Saturday (MMWR rule, matches MOH). Week keys look like `2026-W39`.
- Distances use SVY21 (EPSG:3414); stored geometry is WGS84.
- `models/forecast.joblib` is a dict holding the LightGBM model as text, so it loads on any Python version.

## Data notes (verified 2026-10-09)
- MOH bulletin on data.gov.sg ends at 2022-W52. Weeks from 2023 come from the chart data on NEA's Dengue
  Cases page, saved in `data/recent_cases.csv` (source `nea_page`; rows with source `manual` are hand-entered).
- MSS monthly files lag by a month or two; recent Changi weather comes from the real-time API (station S24).
- Population: SingStat Table Builder C020123 (General Household Survey 2025), all 332 subzones match.
- Clusters: primary source is the JSON feed behind NEA's cluster map (`/api/OneMap/GetMapData/DENGUE_CLUSTER`, has polygons and
  is current). The data.gov.sg Dengue Clusters file lags it by about a week and is the fallback only; `meta.clusters` records
  which was used and the source's own update time. Geometry is never constructed.
- Rainfall stations missing more than 10% of the rain window are skipped and listed in `meta.weather.rain_stations_skipped`.
