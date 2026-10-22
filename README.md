# DengueRadar Copilot

**An AI agent that runs a dengue inspection team's week, end to end.** Built for NEA vector control officers, operations planners and town council teams in Singapore. The agent plans the week from real risk rankings, adapts the plan when officers push back, guides inspectors on site, turns their rough notes into formal reports, and writes the supervisor's weekly review, using NVIDIA Nemotron models on Nebius Token Factory.

**Live app:** https://dengueradar.vercel.app

> **Student prototype, not an official NEA tool.** Plans, checklists, reports and briefings are drafted by AI and must be checked by an officer. The forecast is island-wide; the subzone ranking is a transparent rule-based index that has not yet been validated. **Premises and inspection records are demo data** (see [Demo data](#demo-data)).

## Who it is for and what it does

| Stage | Who | What the Copilot does |
|---|---|---|
| **1. Plan** | Operations planner | Ultra drafts the week's plan from our rankings, area history and recent news (tool calls), with a reason per area and a team per area. The officer asks *why*, or sets constraints ("only 2 teams", "skip areas inspected last week", "8 premises a day"); the agent re-plans and shows what changed. Code fits capacity and orders visits (nearest neighbour). Confirm, then assign to teams and print team sheets. |
| **2. Inspect** | Inspector on a phone | Visit list per team and day. Each premises gets a checklist tailored to its type, layout and breeding history (Nano). Notes are typed or dictated, and Super turns them into a structured service report (JSON) that the inspector edits before saving. Photos are classified by VL, with unclear ones flagged for a retake. |
| **3. Review** | Supervisor | Counts, trends against last week, overdue actions and re-inspections are computed in SQL; Super writes the briefing from those numbers. Repeat or multiple breeding at the same premises is detected in SQL, explained by Nano, and given a rule-based escalation step. |

The original DengueRadar risk map, forecast and model evaluation are still in the app under **Risk map** and **Model**.

## How we use NVIDIA Nemotron + Nebius Token Factory

All model calls go server-side through Token Factory's OpenAI-compatible API (`https://api.tokenfactory.nebius.com/v1/`), with the key in `NEBIUS_API_KEY`; it is never sent to the browser. See `api/_lib/llm.ts`.

| Model | ID | Used for | Why |
|---|---|---|---|
| Nemotron 3 Ultra | `nvidia/Nemotron-3-Ultra-550b-a55b` | Weekly plan and re-planning: tool calling (`rank_areas`, `get_area_risk`, `get_area_history`, `search_recent_context`), then a JSON decision on areas and team regions | The hardest reasoning: risk, vulnerable people, capacity and geography at once |
| Nemotron 3 Super | `nvidia/nemotron-3-super-120b-a12b` | Copilot answers (with tools), routing questions vs plan changes, notes to service report (JSON), supervisor briefing | Strong writing and reliable JSON at lower cost |
| Nemotron 3 Nano | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Site checklists, repeat-offender explanations | Fast and cheap for short, frequent tasks on site |
| Nemotron 3.5 Super VL | `nvidia/Nemotron-3.5-Super-VL` | Photo classification (container / puddle / drain / other) and retake flags | Vision-language |

What we learned and built around:
- **Reasoning is switched off by default** (`chat_template_kwargs.enable_thinking=false`). It saved roughly 90% of tokens on short tasks. In testing, Ultra with reasoning on also invented a tool and figures for it, so the plan runs with reasoning off and unknown tool calls are rejected. Any `<think>` text is stripped before users see output.
- **Two-phase agent.** Ultra researches with tools, then makes its decision in strict JSON mode, choosing only from a candidate table built by code. Free-text final answers drifted from the format.
- **Every number is checked in code** (`api/_lib/checks.ts`). Each plan reason may only use its own area's figures, otherwise it is replaced with code-written facts. Summary sentences and briefing points with unverifiable numbers are removed, and the UI says so. Checklist claims about past breeding are checked against the premises' history.
- **Geometry stays out of the LLM.** The model chooses areas and team home regions; code enforces capacity, keeps teams local (no cross-island detours) and orders visits by nearest neighbour (`api/_lib/routing.ts`).
- **Credit safety** (`api/_lib/guard.ts`): a global daily token cap (`DAILY_TOKEN_CAP`), per-session hourly call limits, per-session limits on Ultra plan runs, sensible `max_tokens` everywhere, and caching of plans, checklists, briefings and flag explanations in Postgres.

## Tavily

`search_recent_context` (`api/_lib/tavily.ts`) searches recent news through the Tavily API (`TAVILY_API_KEY`, server-side). Results are filtered to Singapore-related, non-social-media sources, cached for 12 hours, given ids (S1, S2…) and cited in the plan's "Recent context" with links. The agent may only cite sources it actually retrieved.

## Demo data

Premises (for example "Demo Blk 214, Serangoon Garden") and 8 weeks of past inspections are **fictional**, generated by `scripts/make_demo_data.py` and placed at random points inside the real URA subzone boundaries, so every stage can be demonstrated. Real addresses are deliberately not used, so no real home is linked to made-up breeding records. Demo rows are flagged `is_demo` and shown with a dashed **Demo** badge. Forecasts, rankings, clusters and weather are real data. Reports and photos saved through the app are stored in the prototype's database.

## What's new during the hackathon submission period

Everything below was added for the Nebius x NVIDIA Global AI Hackathon (Best Apps and Agents), on top of the earlier static DengueRadar dashboard:

- **Copilot app on Vercel** (static frontend plus serverless API under `/api`), replacing GitHub Pages. Neon Postgres for plans, chat, assignments, inspections, photos, cache and usage.
- **Plan:** a Nemotron Ultra planning agent with four tools, live step-by-step progress, per-area fact checks, team home regions, capacity enforcement and nearest-neighbour routes; versioned, cached plans with Regenerate.
- **Copilot chat:** Super answers questions with tools and routes constraint changes to Ultra re-plans, with a computed diff of what changed. Confirm a plan to assign visits to teams; printable, shareable team sheets (save as PDF).
- **Inspect:** mobile visit lists, Nano site checklists checked against history, browser dictation, Super notes-to-report in JSON with an editable form, and VL photo evidence with retake flags.
- **Review:** SQL weekly stats vs last week, a Super supervisor briefing with number checks, and repeat-offender detection with Nano explanations and escalation rules.
- **Trust:** the forecast backtest shown as it is, and a new **ranking early check** (`scripts/ranking_check.py`, updated daily) counting whether new clusters appeared in subzones flagged High the week before, with its sample size.
- Credit guard, demo data generator, MIT licence, and this README.

## Model results (island-wide forecast)

Test set: 353 unseen target weeks, 2020-W01 to 2026-W39 (trained on 2012-W08 to 2019-W52, 410 weeks). Copied from `web/public/data/model_eval.json`.

**All test weeks, n = 353**

| Method | MAE (cases) | MAPE | Direction accuracy |
|---|---:|---:|---:|
| LightGBM model | 115.2 | 37.2% | 58.7% |
| Persistence (cases at t) | 87.5 | 29.3% | n/a |
| Seasonal naive (same week last year) | 335.8 | 219.8% | 51.3% |

**Outbreak weeks (above 308 cases, the 75th percentile of training weeks), n = 104**

| Method | MAE (cases) | MAPE | Direction accuracy |
|---|---:|---:|---:|
| LightGBM model | 292.9 | 33.3% | 72.8% |
| Persistence (cases at t) | 211.7 | 30.0% | n/a |
| Seasonal naive (same week last year) | 472.5 | 65.2% | 53.4% |

**Honest summary:** the model did not beat persistence on unseen weeks (higher MAE and MAPE, overall and in outbreak weeks), although it was far better than seasonal naive. The 2020 and 2022 outbreaks peaked at about twice the highest level in the training years, which tree models cannot extrapolate to; what the model adds over persistence is a direction call, correct in about 59% of test weeks and 73% of outbreak weeks.

## Run locally

Requirements: Python 3.11+, Node 20+ (24 on Vercel), the Vercel CLI, and API keys.

```bash
# Python pipeline (data refresh, already run daily by GitHub Actions)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest -q

# App
npm install && npm install --prefix web
cp .env.example .env            # paste NEBIUS_API_KEY and TAVILY_API_KEY
vercel link && vercel env pull .env.local   # DATABASE_URL from the Neon integration
grep DATABASE_URL .env.local >> .env        # vercel dev reads .env only
npm run db:migrate                          # create tables
npm run db:seed-demo                        # load demo premises and inspections
npm run check:nebius                        # confirm the four Nemotron models respond
vercel dev                                  # app and API on http://localhost:3000
```

## Deploy

1. Import the GitHub repo into Vercel (it uses `vercel.json`: builds `web/`, serves `api/` functions).
2. In Vercel, go to **Storage**, create **Neon** and connect it to the project (sets `DATABASE_URL`).
3. In **Settings > Environment Variables** add `NEBIUS_API_KEY`, `TAVILY_API_KEY` (Sensitive) and optionally `DAILY_TOKEN_CAP`, `SESSION_CALLS_PER_HOUR`, `SESSION_ULTRA_CALLS_PER_HOUR`.
4. Run `npm run db:migrate` and `npm run db:seed-demo` once against that database.
5. Every push to `main` deploys. The daily GitHub Action (`.github/workflows/refresh-and-deploy.yml`, 06:00 SGT) refreshes clusters, weather, forecast and rankings and commits them, which triggers a redeploy.

## Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Active dengue clusters (polygons, locality, cases) | Feed behind [NEA's cluster map](https://www.nea.gov.sg/dengue-zika/dengue/dengue-clusters) | NEA website terms of use |
| Dengue Clusters (GeoJSON), fallback | NEA via [data.gov.sg](https://data.gov.sg/datasets/d_dbfabf16158d1b0e1c420627c0819168/view) | Singapore Open Data Licence |
| Weekly Infectious Disease Bulletin (2012 to 2022) | MOH via [data.gov.sg](https://data.gov.sg/datasets/d_ca168b2cb763640d72c4600a68f9909e/view) | Singapore Open Data Licence |
| Weekly dengue cases, 2023 onwards | [NEA Dengue Cases page](https://www.nea.gov.sg/dengue-zika/dengue/dengue-cases) | NEA website terms of use |
| Real-time rainfall and air temperature | NEA via [data.gov.sg](https://data.gov.sg/collections/1459/view) | Singapore Open Data Licence |
| Historical daily records, Changi | [Meteorological Service Singapore](http://www.weather.gov.sg/climate-historical-daily/) | MSS terms of use |
| Master Plan 2019 Subzone Boundary | URA via [data.gov.sg](https://data.gov.sg/datasets/d_8594ae9ff96d0c708bc2af633048edfb/view) | Singapore Open Data Licence |
| Resident population by subzone and age (GHS 2025) | [SingStat Table Builder C020123](https://tablebuilder.singstat.gov.sg/table/CT/C020123) | Singapore Open Data Licence |
| Recent news context | [Tavily](https://tavily.com) search API | Source sites' terms |

## Limitations

- The forecast is island-wide only and did not beat persistence on error in the backtest (see above).
- The subzone ranking is a rule-based index with judgement weights; the early check has a sample of 1 new cluster so far.
- AI-drafted text is checked for numbers, not for every qualitative claim; officers must review plans and reports.
- Premises and past inspections are demo data; repeat-offender and review figures are therefore illustrative.
- Weather comes from limited stations; serotype shifts, immunity and interventions such as Wolbachia releases are not modelled.

## Team: DefinitelyBillionaires

| Name | Role |
|---|---|
| Advait | ML and Data Lead |
| Weng Tin | Product and Frontend Lead |
| Dillon | Public Health Research and Pitch Lead |

Licensed under the [MIT License](LICENSE).
