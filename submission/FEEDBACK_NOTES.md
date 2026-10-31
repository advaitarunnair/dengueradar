# RAW NOTES for the team's feedback on Token Factory, Nemotron and Tavily

**Not finished feedback. Edit it into your own words and keep only what you can stand behind.** These are observations from building and testing this project (22 Oct to 31 Oct 2026). Latencies are from a small number of runs, not a benchmark.

## Token Factory

- All four model IDs were listed by `/v1/models` and answered straight away through the OpenAI SDK with only a base URL change.
- Latency seen: short calls 0.4 to 2 s; checklist (Nano) about 3.4 s; report draft (Super) about 2.6 s; briefing (Super) about 2.4 s; flag explanations for 15 sites (Nano) about 5.3 s; VL photo about 1 s and 350 prompt tokens; a full plan run with tools 10 to 26 s, about 22k tokens.
- We saw no rate-limit errors in our volume. Our limits are all our own (`api/_lib/guard.ts`).
- `TODO(team):` add anything about the console, billing, or credit visibility from your own use.

## Nemotron

- **Reasoning cost.** Reasoning arrives in a separate `reasoning_content` field, so visible output is clean, but it costs tokens: "Reply with exactly OK" took 46 completion tokens on Super with reasoning, and 2 with `chat_template_kwargs.enable_thinking=false`. A `/no_think` system message did not turn it off.
- **Tool calling worked reliably** on Super and Ultra, including parallel calls in one round.
- **Invented tool.** With reasoning on, Ultra once called a tool that doesn't exist (`write_dengue_ops_briefing`) with a large fabricated payload (cluster counts, GDP, fogging schedules). Workaround: reasoning off, and reject unknown tool names.
- **Free-text format drift.** After tool calls, Ultra's free-text final answer ignored the requested JSON and wrote a brief for the wrong week ("Week 28, 2025") with invented regional scores. Workaround: a separate decision call in JSON mode, choosing from a candidate table built by code. JSON mode was reliable.
- **Numbers mixed between items.** Given a long table, Ultra sometimes quoted another row's numbers in a reason, or used a running-total column as a property. Summaries stated totals that were wrong even when told not to. Workaround: the model names data keys, and code renders numbers.
- **Instructions not always followed.** Told to keep to capacity and geography, it still over-filled teams and split regions in some runs. Workaround: enforce these in code.
- **Nano.** Claimed "breeding confirmed on <date>" for habitats where the record didn't show it, so dated claims are checked against history. Explanations tended to restate the input unless given hints.
- **Super.** Turned "told owner to tip" into "tipped" until the prompt distinguished advice from action. Otherwise very good at messy notes to JSON.
- **VL.** Correctly separated a sharp image from a blurred one in our tests with screenshots. `TODO(team):` test on real photos of drains and containers; we did not have any.

## Tavily

- `topic: news` with `include_domains` returned unrelated articles with scores around 0.02. `topic: general` with domains and `time_range` was far better.
- The global news index returned Florida dengue stories for a Singapore query until we filtered by domain.
- Many results have no `published_date`, so we can't call them recent; we label them undated.
- Generic index pages titled "News" or "Advisories" need filtering out; a score threshold of 0.4 helped.
- The `tvly` CLI's OAuth refresh returned HTTP 500 repeatedly on 26 and 31 Oct; the API key was unaffected.
- Caching per week per query makes cost predictable.
