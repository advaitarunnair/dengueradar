# DengueRadar Copilot: draft Devpost description

> Draft for the team to edit. Check every claim against what you demo. `TODO(team):` marks what only you can write.

## What it is

DengueRadar Copilot is an AI agent that runs a dengue inspection team's week in Singapore, from Monday's plan to the supervisor's Friday briefing. It is built for NEA vector control officers, operations planners and town council teams. It is a student prototype, not an official NEA tool.

## Why

Inspection teams have limited hours. Active clusters show where transmission is now, but someone still has to decide where to go next, split work between teams, write up every visit and spot premises that keep breeding. `TODO(team): add why this matters to you, and any conversation you had with people who do this work. Do not invent quotes.`

## How it works

**Plan.** Nemotron 3 Ultra researches with tools (real rankings, area history, targeted Tavily news) and drafts areas and team regions. Officers ask why, or push back ("only 2 teams"), and the agent re-plans and shows what changed. Code enforces capacity, keeps teams local, and orders visits by nearest neighbour.

**Inspect.** On a phone, each premises gets a checklist from Nemotron 3 Nano, tailored to its type and breeding history. Dictated notes become a structured report via Nemotron 3 Super, which the inspector edits. Nemotron 3.5 Super VL labels photos and asks for a retake when unclear.

**Review.** SQL computes counts, trends and overdue actions. Super writes the briefing from those numbers. Repeat breeding is detected in SQL, with habitat-specific advice and rule-based escalation.

The agent sits on a real data pipeline: NEA clusters, station weather, URA boundaries and SingStat population, refreshed daily, plus an island-wide LightGBM forecast. Premises and inspection records are clearly labelled demo data.

## Nemotron and Token Factory

All models are called server-side through Token Factory's OpenAI-compatible API, each matched to a job: Ultra for planning, Super for writing, Nano for fast on-site tasks, VL for photos.

The design rule is that a model never writes a number that code can't verify. The planner names data keys and writes number-free notes, and code renders the figures from each area's own data. The clickable "numbers checked" badge shows what was checked and corrected.

## Challenges

- With reasoning on, Ultra once invented a tool and fabricated figures for it. We run planning with reasoning off, reject unknown tools, and split research from a strict JSON decision.
- Free-text reasons mixed up numbers between areas, which is why reasons are now rendered by code.
- Our first ranking put a subzone beside a 99-case cluster at #15, while population alone lifted a Low-band subzone to #3. We rebuilt it with log-scaled cluster pressure and a large-cluster override.
- Our first forecast lost to a simple "same as this week" rule on unseen years. A ratio target blended with persistence now beats it on average error (76.8 vs 87.5 cases a week), though not on percentage error, and with a modest lead.

## What we're proud of

Honest evaluation shown in the app, a verifier you can inspect, and a site that keeps working without anyone touching it: a weekly plan drafted automatically, a private sandbox for every visitor, and credit limits that fall back to saved results.

## What's next

- Validate the ranking against where clusters appear: so far, 0 of 6 new clusters landed in a subzone flagged High, on a sample far too small to conclude anything.
- Move the daily pipeline to Nebius Serverless Jobs (`TODO(team): update if you complete this`).
- Add serotype surveillance data to the forecast.
- `TODO(team): pilot plans, if any.`

## What we updated during the Submission Period

`TODO(team): the project started before this hackathon (the static dashboard). Confirm the dates against the 26 Aug 2026 rule, then adapt the README's "What's new" list. Everything Copilot-related was added for this hackathon.`
