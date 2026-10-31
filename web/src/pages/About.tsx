import { Card, Disclaimer, Status } from '../components/ui'
import { useData } from '../lib/data'
import type { Meta } from '../types'

const TEAM = [
  { name: 'Advait', role: 'ML and Data Lead', did: 'forecast model, honest evaluation against baselines, and the automated data pipeline' },
  { name: 'Weng Tin', role: 'Product and Frontend Lead', did: 'dashboard, map and the inspection-list workflow for officers' },
  { name: 'Dillon', role: 'Public Health Research and Pitch Lead', did: 'problem research, the subzone risk index design, and the demo' },
]

export default function About() {
  const { data: meta, error, loading } = useData<Meta>('meta.json')
  if (error || !meta) return <Status loading={loading} error={error} />
  const w = meta.scoring.weights
  const r = meta.scoring.ranking ?? { override_km: 1, override_cases: 10, priority_risk_exponent: 2, priority_population_exponent: 0.5 }
  return (
    <div className="space-y-5">
      <Card title="The problem">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink">
          <p>Dengue inspection teams have limited hours each week. Active clusters show where transmission is happening now, but deciding which neighbourhoods to check next, splitting the work between teams, writing up every visit and spotting premises that keep breeding all take officers’ time away from inspecting.</p>
          <p>DengueRadar Copilot is an AI agent that runs a dengue inspection team’s week end to end, for NEA vector control officers, operations planners and town council teams. It works from a real, weekly-refreshed risk ranking and an island-wide machine learning forecast.</p>
        </div>
      </Card>
      <Card title="How the Copilot runs the week">
        <ol className="max-w-3xl list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink">
          <li><strong>Plan.</strong> The agent looks up this week’s rankings, area details and recent news with tools, then drafts which subzones to inspect, why, and which team takes each. Officers ask why, or push back (“only 2 teams”, “skip areas done last week”); the agent re-plans and shows what changed. Code fits the plan to team capacity and orders each team’s visits by nearest neighbour. Officers confirm, and visits are assigned to teams with printable team sheets.</li>
          <li><strong>Inspect.</strong> On site, each premises gets a checklist tailored to its type, layout and breeding history. Inspectors type or dictate rough notes and the agent turns them into a structured service report they can edit before saving. Photos are labelled (container, puddle, drain) and unclear ones flagged for a retake.</li>
          <li><strong>Review.</strong> Counts, trends and overdue actions are computed from the saved reports; the agent writes the supervisor’s weekly briefing from those numbers. Premises with repeat breeding are detected in SQL, explained, and given an escalation step.</li>
        </ol>
      </Card>
      <Card title="NVIDIA Nemotron on Nebius Token Factory">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3"><th className="py-2 pr-3 font-medium">Model</th><th className="py-2 pr-3 font-medium">Used for</th><th className="py-2 font-medium">Why this one</th></tr></thead>
            <tbody>
              <tr className="border-b border-line"><td className="py-2 pr-3 font-medium">Nemotron 3 Ultra</td><td className="py-2 pr-3">Weekly plan and re-planning (tool calling)</td><td className="py-2 text-ink-2">Hardest reasoning: trading off risk, people, capacity and geography</td></tr>
              <tr className="border-b border-line"><td className="py-2 pr-3 font-medium">Nemotron 3 Super</td><td className="py-2 pr-3">Copilot answers, service reports, supervisor briefing</td><td className="py-2 text-ink-2">Strong writing and structured JSON at lower cost</td></tr>
              <tr className="border-b border-line"><td className="py-2 pr-3 font-medium">Nemotron 3 Nano</td><td className="py-2 pr-3">Site checklists, repeat-offender explanations</td><td className="py-2 text-ink-2">Fast and cheap for short, frequent tasks on site</td></tr>
              <tr><td className="py-2 pr-3 font-medium">Nemotron 3.5 Super VL</td><td className="py-2 pr-3">Photo classification and retake flags</td><td className="py-2 text-ink-2">Vision-language model for inspection photos</td></tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 max-w-3xl list-disc space-y-1 pl-5 text-sm text-ink">
          <li>Every number the agent writes is checked in code against our data. A plan reason may only use its own area’s figures; anything unverifiable is removed or flagged on screen.</li>
          <li>Geometry and arithmetic stay in code: capacity checks, team geography fallbacks and nearest-neighbour visit order.</li>
          <li>Recent context comes from Tavily search, filtered to Singapore sources, and is cited by source.</li>
          <li>Credit safety: a daily token cap, per-session limits, and cached plans, checklists and briefings.</li>
        </ul>
      </Card>
      <Card title="Demo data">
        <p className="max-w-3xl text-sm leading-relaxed text-ink">Premises (“Demo Blk 214, Serangoon Garden”) and past inspection records are <strong>fictional demo data</strong>, placed inside real subzone boundaries so every stage can be shown. They are marked with a dashed “Demo” badge. Rankings, clusters, weather and the forecast are real data. Reports and photos saved in this app are stored in the prototype’s database.</p>
      </Card>
      <Card title="How the ranking works">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink">
          <p>Each of the {meta.scoring.eligible_subzones} URA subzones with at least {meta.scoring.min_residents} residents gets three scores from 0 to 1:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Spread</strong>: for every active cluster, its case count × e<sup>−distance in km</sup>, added up. Distance is from the subzone centre to the cluster boundary. This pressure is log-scaled and divided by the highest value: log(1 + pressure) / max.</li>
            <li><strong>Rain</strong>: total rainfall from 8 weeks to 2 weeks ago at the nearest weather station that is missing no more than {meta.weather.rain_max_missing_share * 100}% of those days, as a percentile across subzones.</li>
            <li><strong>Temp</strong>: mean air temperature over the last 4 weeks at the nearest station with data, as a percentile across subzones.</li>
          </ul>
          <pre className="overflow-x-auto rounded-md border border-line bg-page p-3 text-xs">{`risk     = ${w.spread} × spread + ${w.rain} × rain + ${w.temp} × temp
priority = risk^${r.priority_risk_exponent} × (residents aged 65+ and under 15)^${r.priority_population_exponent}`}</pre>
          <p><strong>Large-cluster override.</strong> Any subzone within {r.override_km} km of an active cluster of {r.override_cases} or more cases is always High and listed ahead of every other subzone.</p>
          <p><strong>Bands.</strong> After the overrides, the rest of the High band and then the Elevated band are filled by risk. When the outlook is Rising, High is {meta.scoring.bands.Rising.high * 100}% of subzones and Elevated the next {meta.scoring.bands.Rising.elevated * 100}%. When it is Stable or Falling, High is {meta.scoring.bands.Stable.high * 100}% and Elevated the next {meta.scoring.bands.Stable.elevated * 100}%. If overrides exceed the High quota, all of them are still High.</p>
          <p><strong>Order.</strong> Overrides first, then High, Elevated and Low, and by priority within each.</p>
          <p><strong>Why this method.</strong> Under the earlier version (percentile spread, priority = risk × population, sorted by priority alone), a subzone next to a 99-case cluster could rank 15th and be cut from the plan, while a Low-band subzone ranked 3rd on population alone. This fixes the ordering problem. It is not evidence of better prediction: in the early check against new clusters, the two methods currently tie, on a sample far too small to conclude anything.</p>
          <p><strong>What you can change.</strong> The three risk weights are a judgement, not a fitted result, and you can adjust them with the sliders on the risk map. These are fixed: the {r.override_km} km / {r.override_cases}-case override, the priority exponents ({r.priority_risk_exponent} and {r.priority_population_exponent}), log scaling, the {meta.scoring.decay_km} km distance decay and the band shares.</p>
        </div>
      </Card>
      <Card title="Data sources">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3"><th className="py-2 pr-3 font-medium">Dataset</th><th className="py-2 pr-3 font-medium">Agency</th><th className="py-2 font-medium">Licence</th></tr>
            </thead>
            <tbody>
              {meta.sources.map((s) => (
                <tr key={s.url} className="border-b border-line">
                  <td className="py-2 pr-3"><a href={s.url} target="_blank" rel="noreferrer" className="text-accent underline">{s.name}</a></td>
                  <td className="py-2 pr-3 text-ink-2">{s.agency}</td>
                  <td className="py-2 text-ink-2">{s.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-2">Rainfall this week: {meta.weather.rain_stations_with_data} stations used. {meta.weather.rain_stations_skipped.length} skipped for missing more than {meta.weather.rain_max_missing_share * 100}% of the {meta.weather.rain_window_days}-day window{meta.weather.rain_stations_skipped.length > 0 ? ` (${meta.weather.rain_stations_skipped.map((s) => `${s.name === s.id ? s.id : `${s.name} ${s.id}`}: ${s.missing_days} days`).join('; ')})` : ''}; subzones near them use the next nearest station.</p>
        <p className="mt-2 text-xs text-ink-2">Population reference year: {meta.population_reference_year}. Weekly cases to {meta.case_data.bulletin_last_week} are from the MOH bulletin; later weeks are from NEA's published weekly counts. Recent news context in plans comes from Tavily search. Datasets from data.gov.sg and SingStat are used under the <a className="text-accent underline" href="https://data.gov.sg/open-data-licence" target="_blank" rel="noreferrer">Singapore Open Data Licence</a>. Map tiles © OpenStreetMap contributors.</p>
      </Card>
      <Card title="The team: DefinitelyBillionaires">
        <ul className="space-y-1.5 text-sm text-ink">
          {TEAM.map((t) => (
            <li key={t.name}><strong>{t.name}</strong> <span className="text-ink-2">· {t.role}: {t.did}</span></li>
          ))}
        </ul>
      </Card>
      <Card title="What runs where">
        <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink">
          <li><strong>The app</strong> is hosted on Vercel: a static web page plus serverless API routes under /api, which call the Nemotron models and read and write a Neon Postgres database.</li>
          <li><strong>The daily data job</strong> rebuilds clusters, weather, forecast and ranking at 06:00 Singapore time and publishes them with a commit, which redeploys the site. It runs on GitHub Actions; a Nebius Serverless Job version is built and waiting for cloud setup.</li>
          <li><strong>The weekly default plan</strong> is drafted once by a scheduled call, so visits never spend tokens on it.</li>
          <li><strong>The Refresh data button</strong> in the header loads the newest published data without reloading the page. It does not start a new data run.</li>
          <li><strong>Your changes are private to you.</strong> Re-plans, chat, reports and photos belong to your browser session; <strong>Reset demo</strong> removes them.</li>
        </ul>
      </Card>
      <Card title="Disclaimer">
        <Disclaimer />
      </Card>
    </div>
  )
}
