# PLAN.md: pre-submission fixes (branch `hackathon-fixes`)

Status: **waiting for approval**. Nothing has been edited except this file.
Deadline: 31 Oct 01:00 SGT. Work order: P0 (Tasks 1 to 3), then P1 (4, 7, 5, 6), then P2 (8, 9).
Overriding rule from you: **existing functionality must keep working.** Every task ends with the regression pass at the bottom.

## What I checked first (current state, E-week 43)

- The ranking evidence in the brief is confirmed on today's real data: Taman Jurong is 0.01 km from a 99-case cluster (148 cluster cases island-wide) and ranks #15 (Elevated). Fernvale is band Low, 3.99 km from the nearest cluster, and ranks #3. Toa Payoh Central (High) ranks #18.
- Production database: W43 has plan v1 (5 reasons fell back to facts) and v2 (the 2-team re-plan), 4 copilot messages, 0 saved reports, 0 photos. Demo inspections span 30 Aug to 22 Oct.
- Token use: 321k on 22 Oct, 4k on 24 Oct, 73k so far on 26 Oct (UTC days).
- **Preview and production share one Neon database.** The Neon integration was connected without per-deployment branches. So a Vercel preview cannot be tested without changing production data (see Decision 1).
- Nebius Serverless AI jobs have create/run CLI and API, but the docs show no built-in cron. A weekly or daily schedule needs an outside timer (GitHub Actions or Vercel Cron) that starts the Nebius job.
- The Tavily CLI login on this machine is failing on Tavily's side (HTTP 500 on token refresh). The app's own API key works.

## Decisions and things I need from you

1. **A separate database for previews (blocks safe testing of Tasks 1 to 3).** Recommended: a Neon branch called `preview`, a copy-on-write copy of production that we can reset freely. Either:
   - (a) create it in the Neon console (Branches > New branch from `main`) and send me nothing: I set the Preview `DATABASE_URL` in Vercel from the branch's connection string, which you paste into a local file; or
   - (b) give me a Neon API key in `.env` (`NEON_API_KEY`) and I create it with `neonctl`.
   Until this exists I will only test locally against a local copy, never against production.
2. **Canonical W43 plan.** After the ranking fix, I propose generating a new canonical plan for W43 with default constraints. The team's v1/v2 become "legacy" rows that no visitor sees by default. OK? (Nothing is deleted.)
3. **Credit budget for judging.** What is the remaining Token Factory credit balance? I need it to set the caps in Task 1d. Without it I'll assume about 3M tokens for 15 days (about 200k/day) and a lower cap than today's 400k.
4. **Nebius Serverless Jobs (Task 6).** Needs: a Nebius AI Cloud project with billing; you logging in to the `nebius` CLI once; a service account key for the timer; a GitHub fine-grained token (contents: write on this repo) stored as a Nebius secret so the job can publish data. I will build everything up to deployment and document it in `docs/nebius-jobs.md`, then stop.
5. **Ranking defaults (Task 3).** Proposed: log-scaled cluster pressure, cluster override at 1.0 km / 10 cases, `priority = risk² × population^0.5`, band-first sort. Say if you want different values.
6. **Capacity packing (Task 8).** Proposed: when a higher-priority area doesn't fit a team's remaining slots, include it *partially* (the premises that fit, history-of-breeding first) instead of cutting it. Simpler than cross-team splitting and clearer to explain.

## Cross-cutting design (affects several tasks)

- **Effective date.** One helper `today()` in `api/_lib/epi.ts`: real Singapore date in production; overridable by `DEMO_DATE` env or `?asof=YYYY-MM-DD` only when `VERCEL_ENV !== 'production'`. The current E-week, plan key, demo roll-forward, overdue maths and Review default all use it. Real data (rankings, clusters, forecast) can't time-travel; "as of 8 Dec" shows the latest real data with December-dated plan and demo records. This will be stated in the code comments and README.
- **Visitor sandbox.** Additive schema migration: `session_id text` (null means canonical or legacy) on `plans`, `plan_messages`, `inspections`, `photos`; `is_canonical boolean` on `plans`. `assignments` follow their plan. Read rule: a visitor sees their own rows plus canonical/demo rows, never another visitor's. Writes are always session-scoped. A "Reset demo" control deletes only that session's rows. Session id: the existing localStorage UUID, with a per-tab random fallback when storage is blocked (today the fallback is one shared id).
- **Canonical weekly plan.** A protected `POST /api/cron/weekly-plan` (secret header, Vercel Cron once a day) makes sure a canonical plan exists for the current E-week, generating once and doing nothing on later calls. The Nebius job (Task 6) calls the same code. Visitors' Regenerate and copilot re-plans create session copies, never touch the canonical plan.

## Tasks mapped to files

### P0

**Task 1: Works during December judging**
- a. Rolling demo data. Port the demo inspection generator to TypeScript (`api/_lib/demo.ts`) with a seeded RNG keyed by the anchor week, so the same week always produces the same records. Premises stay fixed. Inspection history covers the 8 complete weeks before the effective week plus the current partial week, with today's distribution (repeat, persistent, multiple-habitat sites, overdue follow-ups, habitat mix). An `ensureDemoData()` call regenerates only when the stored anchor week differs (cheap, no LLM), run from the cron endpoint and lazily on API reads. Keep `scripts/make_demo_data.py` as the Python reference or retire it (and say so in the README). Files: `api/_lib/demo.ts` (new), `api/_lib/review.ts`, `api/inspect.ts`, `db/schema.sql`, `scripts/db_seed_demo.ts`.
- b. Automatic weekly plan: `api/cron/weekly-plan.ts` (new), `vercel.json` (crons), `api/_lib/plans.ts`, `api/plan.ts`. Uses a DB advisory lock so concurrent first visits can't trigger two generations.
- c. Sandbox: `db/schema.sql`, `api/_lib/plans.ts`, `api/plan.ts`, `api/copilot.ts`, `api/_lib/copilot.ts`, `api/inspect.ts`, `api/_lib/inspect.ts`, `api/_lib/review.ts`, `api/photos.ts`, `web/src/lib/api.ts`, new `api/session.ts` (reset), Reset demo button in `web/src/components/Layout.tsx`.
- d. Credit headroom: `api/_lib/guard.ts` adds a global daily cap on Ultra runs, a per-IP hourly limit (stops session-id rotation), lower defaults; every LLM endpoint returns cached output plus a clear message on a limit instead of an error state (`Plan.tsx`, `CopilotChat.tsx`, `InspectPremises.tsx`, `Review.tsx`). Daily usage readable at `GET /api/usage` (token totals per day and model, no secrets) and `npm run usage`.
- e. Time travel: `api/_lib/epi.ts`, `web/src/lib/api.ts` (passes `asof` through), a small banner "Viewing as of 8 Dec 2026 (preview only)".
- Risks: the migration must be additive and run on production only after you approve; the time-travel override must be impossible in production (test it).

**Task 2: No empty cold start**
- Plan shows the canonical plan at once. Inspect, with no session plan confirmed, shows the canonical plan's assignments with a one-click "Load demo plan", which confirms a session copy. Review defaults to the most recent *complete* week with data, keeping the selector.
- Files: `web/src/pages/Plan.tsx`, `Inspect.tsx`, `Review.tsx`, `api/inspect.ts`, `api/review.ts`.

**Task 3: Ranking**
- `config.yaml` gets a `ranking:` block: `cluster_scaling: log|percentile`, `override_km: 1.0`, `override_cases: 10`, `priority_risk_exponent: 2`, `priority_population_exponent: 0.5`, `sort: band_first|priority`.
- `scripts/build_scores.py`: `spread_components` adds `max_cluster_cases_within_override_km`. `score_subzones` implements both methods behind config: log1p pressure normalised by max, override to High, new priority, band-first sort. Overrides are always High and placed first; the remaining High slots are filled by risk.
- `web/src/lib/scoring.ts` mirrors it so the weight sliders still work. Non-adjustable parameters are listed on the About page.
- `scripts/compare_ranking.py` (new): old vs new top 20 for the current week, highlighting the five named subzones.
- `scripts/ranking_check.py`: early check reported for both methods from the same start date (historical new-method bands recomputed from the git history of `scores.geojson` and `clusters.geojson`; stored in the log so CI's shallow clone doesn't need history).
- Text that describes the formula: `About.tsx` "How the ranking works", `api/_lib/planner.ts` and `api/_lib/copilot.ts` system prompts, `api/_lib/tools.ts` descriptions, README.
- Tests: `tests/test_scoring.py` (override, sort, both methods), TypeScript scoring parity test.
- Risk: rankings change for everyone at the next daily refresh; history snapshots before the switch keep old-method bands (labelled).

### P1

**Task 4: Forecast** (`scripts/train_model.py`, `web/public/data/model_eval.json`, `forecast_test.json`, `web/src/pages/Model.tsx`, `TrustStrip.tsx` → one compact line)
- Ratio target `log((c₄+ε)/(c₀+ε))`, blend α chosen on the 2019 validation slice only, "trend continues" direction baseline. Same split. Adopt for production only if test MAE beats persistence; otherwise report it plainly. Risk: none to production unless adopted; the model file only changes if adopted.

**Task 7: Numbers at the source** (`api/_lib/planner.ts`, `checks.ts`, `review.ts`, `inspect.ts`, `TeamCard.tsx`, `Plan.tsx`, new `VerifierPanel.tsx`)
- Planner JSON: `factors` (enum of data keys) plus a number-free `note`; code renders the numbers. Summary and briefing use `{{fact_key}}` placeholders filled by code; unknown keys drop the point. The verifier stays as a backstop with natural fallback prose. The "N numbers checked" badge opens a panel of what was checked and corrected. Service reports: any number must appear in the inspector's notes.

**Task 5: Tavily** (`api/_lib/tavily.ts`, `tools.ts`, `planner.ts`, `copilot.ts`, `Plan.tsx`)
- 4 targeted queries in code (NEA dengue updates; serotype shift; MSS/NEA weather advisories; top planning areas) with domain filters, news topic and a recent time range (parameter names verified against Tavily's docs at implementation). Cached per E-week per query. Structured items go to the planner; the UI shows the queries run when nothing matched. A copilot `search_news` tool.

**Task 6: Nebius Serverless Jobs** (`job/Dockerfile`, `job/pipeline.sh` (new), `.github/workflows/nebius-pipeline.yml` (new), `docs/nebius-jobs.md` (new), README, `About.tsx`)
- One container running the Python pipeline, the canonical plan check and the demo roll-forward, then publishing by commit (which redeploys Vercel). GitHub Actions stays as the timer and the manual fallback. Blocked on Decision 4 for deployment. Fix the inaccurate "this site has no server" text now.

### P2

**Task 8: Bugs.** Week labels "latest reported (E-week 41)" in prompts and UI (`planner.ts`, `OutlookCard.tsx`, `Plan.tsx`). Team region labels made in code and passed to the model; the summary no longer states regions itself. Capacity facts given to the copilot, and partial-area packing (Decision 6) with precise "Removed by checks" text. Habitat-specific repeat-offender actions (code mapping plus Nano phrasing). Fit both maps to Singapore's subzone bounds (`RiskMap.tsx`, `PlanMap.tsx`). Check every page at 375 px and the console; investigate `ERR_ABORTED` on the streaming POSTs.

**Task 9: Submission materials.** README additions (Mermaid architecture and the other sections listed), LICENSE (MIT already exists), `submission/DESCRIPTION.md`, `submission/VIDEO_SCRIPT.md`, `submission/FEEDBACK_NOTES.md` (raw notes from the code and logs: reasoning-off savings, Ultra's invented tool, JSON drift, the number-mixing we caught, latencies, the Tavily OAuth 500). `TODO(team):` wherever your words are needed.

## Regression pass after every task ("functionality not affected")

Plan: load, Regenerate, copilot question, copilot re-plan with diff, confirm, team sheets. Inspect: visit list, checklist, notes → draft → edit → save, photo upload. Review: tiles, briefing, repeat offenders, week switch. Risk map: sliders, CSV, print. Model and About pages. Python tests, TypeScript type checks, web build. No new console errors. At 375 px: no horizontal scroll.

## Final verification (as the brief asks)

Tests added for: ranking override and sort, capacity packing, demo roll-forward, number rendering. `compare_ranking` output and the full forecast table pasted in the summary. A preview with `DEMO_DATE=2026-12-08` checked in two fresh sessions (populated and isolated), with screenshots. 3 regenerations with no fallback strings and matching team labels. Each 3-regeneration test costs about 75k tokens, so this is timed after the daily cap resets.
