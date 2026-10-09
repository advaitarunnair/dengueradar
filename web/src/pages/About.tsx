import { Card, Disclaimer, Status } from '../components/ui'
import { useData } from '../lib/data'
import type { Meta } from '../types'

export default function About() {
  const { data: meta, error, loading } = useData<Meta>('meta.json')
  if (error || !meta) return <Status loading={loading} error={error} />
  const w = meta.scoring.weights
  return (
    <div className="space-y-5">
      <Card title="The problem">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink">
          <p>Dengue inspection teams have limited hours each week. Active clusters show where transmission is happening now, but they do not say which nearby neighbourhoods to check next, or how much effort the coming month deserves.</p>
          <p>DengueRadar is a weekly shortlist for NEA vector control officers, operations planners and town councils. It answers two questions: how urgent are the next four weeks (a machine learning forecast), and where should teams look first (a transparent subzone ranking).</p>
        </div>
      </Card>
      <Card title="How the ranking works">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink">
          <p>Each of the {meta.scoring.eligible_subzones} URA subzones with at least {meta.scoring.min_residents} residents gets three scores, each turned into a 0 to 1 percentile across subzones:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Spread</strong>: for every active cluster, its case count × e<sup>−distance in km</sup>, added up. Distance is from the subzone centre to the cluster boundary.</li>
            <li><strong>Rain</strong>: total rainfall from 8 weeks to 2 weeks ago at the nearest weather station that is missing no more than {meta.weather.rain_max_missing_share * 100}% of those days.</li>
            <li><strong>Temp</strong>: mean air temperature over the last 4 weeks at the nearest station with data.</li>
          </ul>
          <pre className="overflow-x-auto rounded-md border border-line bg-page p-3 text-xs">{`risk     = ${w.spread} × spread + ${w.rain} × rain + ${w.temp} × temp
priority = risk × (residents aged 65+ and under 15)`}</pre>
          <p>Subzones are banded by risk. When the outlook is Rising, the top {meta.scoring.bands.Rising.high * 100}% are High and the next {meta.scoring.bands.Rising.elevated * 100}% Elevated. When it is Stable or Falling, the top {meta.scoring.bands.Stable.high * 100}% are High and the next {meta.scoring.bands.Stable.elevated * 100}% Elevated. The inspection list is sorted by priority, so that among risky areas, those with more seniors and children come first.</p>
          <p>The weights are a judgement, not a fitted result. You can change them on the dashboard to see how the list moves.</p>
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
        <p className="mt-2 text-xs text-ink-2">Population reference year: {meta.population_reference_year}. Weekly cases to {meta.case_data.bulletin_last_week} are from the MOH bulletin; later weeks are from NEA's published weekly counts. Datasets from data.gov.sg and SingStat are used under the <a className="text-accent underline" href="https://data.gov.sg/open-data-licence" target="_blank" rel="noreferrer">Singapore Open Data Licence</a>. Map tiles © OpenStreetMap contributors.</p>
      </Card>
      <Card title="The team">
        <p className="text-sm text-ink-2">Built by a student team for a machine learning hackathon. Team names and roles to be added.</p>
      </Card>
      <Card title="Disclaimer">
        <Disclaimer />
      </Card>
    </div>
  )
}
