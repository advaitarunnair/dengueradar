import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Status } from '../components/ui'
import { useData } from '../lib/data'
import { num, weekLabel } from '../lib/format'
import type { FeatureImportance, ForecastPoint, MethodName, MetricRow, ModelEval } from '../types'

const SERIES: { key: 'actual' | 'blend' | 'model' | 'persistence' | 'seasonal'; name: string; color: string; dash?: string }[] = [
  { key: 'actual', name: 'Actual cases', color: '#14181d' },
  { key: 'blend', name: 'Forecast (current)', color: '#2a78d6' },
  { key: 'persistence', name: 'Persistence baseline', color: '#eb6834', dash: '5 3' },
  { key: 'seasonal', name: 'Seasonal baseline', color: '#1baf7a', dash: '2 3' },
  { key: 'model', name: 'Previous model', color: '#4a3aa7', dash: '1 3' },
]
const ORDER: MethodName[] = ['blend_ratio', 'ratio', 'model', 'blend_level', 'persistence', 'seasonal', 'trend']
const FALLBACK_NAMES: Partial<Record<MethodName, string>> = { model: 'LightGBM', persistence: 'Persistence (same as this week)', seasonal: 'Seasonal naive (same week last year)' }
const AXIS = { fontSize: 12, fill: '#7b8591' }

function MetricsTable({ title, note, rows, names, adopted }: { title: string; note: string; rows: Partial<Record<MethodName, MetricRow>>; names: Partial<Record<MethodName, string>>; adopted: MethodName | null }) {
  const present = ORDER.filter((k) => rows[k])
  const best = (f: (r: MetricRow) => number | null) => Math.min(...present.map((k) => f(rows[k]!) ?? Infinity))
  const bestMae = best((r) => r.mae)
  const bestMape = best((r) => r.mape)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <caption className="pb-2 text-left text-sm font-semibold text-ink">{title} <span className="font-normal text-ink-2">({note})</span></caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-3">
            <th className="py-2 pr-3 font-medium">Method</th>
            <th className="py-2 pr-3 text-right font-medium">MAE (cases)</th>
            <th className="py-2 pr-3 text-right font-medium">MAPE</th>
            <th className="py-2 text-right font-medium">Direction accuracy</th>
          </tr>
        </thead>
        <tbody>
          {present.map((k) => {
            const r = rows[k]!
            return (
              <tr key={k} className="border-b border-line">
                <td className="py-2 pr-3 text-ink">
                  {names[k] ?? FALLBACK_NAMES[k] ?? k}
                  {k === adopted && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">In use</span>}
                </td>
                <td className={`py-2 pr-3 text-right tabular-nums ${r.mae === bestMae ? 'font-semibold' : ''}`}>{r.mae === null ? 'n/a' : r.mae.toFixed(1)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${r.mape === bestMape ? 'font-semibold' : ''}`}>{r.mape === null ? 'n/a' : `${r.mape.toFixed(1)}%`}</td>
                <td className="py-2 text-right tabular-nums">{r.direction_accuracy === null ? 'n/a' : `${(r.direction_accuracy * 100).toFixed(1)}%`}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Model() {
  const ev = useData<ModelEval>('model_eval.json')
  const test = useData<ForecastPoint[]>('forecast_test.json')
  const imp = useData<FeatureImportance[]>('feature_importance.json')
  const { data: early } = useData<{ new_clusters: number; in_high_prior_week: number; in_high_or_elevated_prior_week: number; since: string; note: string; new_method?: { in_high_prior_week: number; in_high_or_elevated_prior_week: number } }>('ranking_check.json')
  const error = ev.error ?? test.error ?? imp.error
  if (error || !ev.data || !test.data || !imp.data) return <Status loading error={error} />
  const e = ev.data
  const all = e.metrics.all_test_weeks
  const adopted = e.experiments?.adopted ?? null
  const inUse = (adopted && all[adopted]) || all.model
  const names = e.method_names ?? {}
  const pct = (x: number | null | undefined) => `${((x ?? 0) * 100).toFixed(0)}%`
  const inUseOutbreak = (adopted && e.metrics.outbreak_weeks[adopted]) || e.metrics.outbreak_weeks.model
  const yearTicks = test.data.filter((p) => p.epi_week.endsWith('-W01')).map((p) => p.epi_week)

  return (
    <div className="space-y-5">
      <Card title="How the forecast works">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink">
          <p>Every week the model looks at how many dengue cases Singapore reported in the last four weeks, and at rainfall and temperature at Changi over the two months before. From these it estimates how many cases the whole island will report four weeks from now. It is one number for the whole country, not a forecast for each neighbourhood.</p>
          <p>The forecast uses a LightGBM gradient-boosted tree model that predicts the <em>ratio</em> between cases in four weeks and cases now, blended with a simple “same as this week” estimate ({Math.round((e.experiments?.settings.ratio?.alpha ?? 0) * 100)}% model). Tree models cannot predict above what they saw in training, and the 2020 and 2022 outbreaks peaked at about twice the training maximum; predicting a ratio avoids that ceiling. It learned from weekly data with target weeks from {weekLabel(e.train.first_target_week)} to {weekLabel(e.train.last_target_week)} ({e.train.n_weeks} weeks), and was tested on {e.test.n_weeks} later weeks it had never seen ({weekLabel(e.test.first_target_week)} to {weekLabel(e.test.last_target_week)}). Settings and the blend weight were chosen on the last {e.train.validation_weeks} training weeks only. Weather is lagged by 2 to 8 weeks because mosquitoes need time to breed and the virus needs time to incubate.</p>
          <p>We compare it with simple rules. Persistence says “cases in four weeks will equal cases this week”. Seasonal naive says “cases will equal the same week last year”. Trend continues says “cases will keep moving the way they did over the last four weeks”. A model only earns trust if it beats these.</p>
          <p className="rounded-md border border-line bg-accent-soft px-3 py-2">
            <strong>Honest result:</strong>{' '}
            {adopted
              ? <>on unseen weeks the forecast’s average error was {inUse.mae?.toFixed(0)} cases a week against {all.persistence.mae?.toFixed(0)} for persistence and {all.seasonal.mae?.toFixed(0)} for seasonal naive; in outbreak weeks, {inUseOutbreak.mae?.toFixed(0)} against {e.metrics.outbreak_weeks.persistence.mae?.toFixed(0)}. But the lead is modest: as a percentage error, persistence is still slightly better ({all.persistence.mape?.toFixed(1)}% against {inUse.mape?.toFixed(1)}%). It calls the direction right {pct(inUse.direction_accuracy)} of the time, barely above the trend rule ({pct(all.trend?.direction_accuracy)}). This variant was adopted after being compared on these same test weeks, so treat the lead as encouraging rather than proven. DengueRadar uses the forecast only to set how many subzones are flagged High.</>
              : <>on unseen weeks no variant beat persistence on average error ({all.model.mae?.toFixed(0)} cases a week against {all.persistence.mae?.toFixed(0)}). DengueRadar uses the forecast only to set how many subzones are flagged High.</>}
          </p>
        </div>
      </Card>

      <Card title="Accuracy on unseen weeks">
        <div className="space-y-6">
          <MetricsTable title="All test weeks" note={`${all.model.n} weeks`} rows={all} names={names} adopted={adopted} />
          <MetricsTable title="Outbreak weeks only" note={`${e.metrics.outbreak_weeks.model.n} weeks above ${e.outbreak_threshold_cases} cases, the 75th percentile of training weeks`} rows={e.metrics.outbreak_weeks} names={names} adopted={adopted} />
        </div>
        <p className="mt-3 text-xs text-ink-2">MAE is the average miss in weekly cases; MAPE is the average miss as a percentage; lower is better for both. Direction accuracy is how often a method correctly says cases in 4 weeks will be higher or lower than now. Persistence always predicts no change, so it has no direction; trend continues only predicts direction, so it has no error figures. Bold marks the lowest error. Cases to {e.case_sources.moh_bulletin[1]} are from the MOH bulletin{e.case_sources.nea_page ? `; later weeks are NEA's published weekly counts` : ''}.</p>
      </Card>

      <Card title="Actual cases against the model and both baselines (test period)">
        <div className="h-[360px] w-full">
          <ResponsiveContainer>
            <LineChart data={test.data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e2e6ea" vertical={false} />
              <XAxis dataKey="epi_week" ticks={yearTicks} tickFormatter={(w: string) => w.slice(0, 4)} tick={AXIS} axisLine={{ stroke: '#c3c9cf' }} tickLine={false} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => num(v)} label={{ value: 'Weekly cases', angle: -90, position: 'insideLeft', style: { ...AXIS, textAnchor: 'middle' } }} />
              <Tooltip formatter={(v) => num(Math.round(Number(v)))} labelFormatter={(w) => `Target week ${String(w)}`} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e6ea' }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#4b5560' }} formatter={(v) => <span style={{ color: '#4b5560' }}>{v}</span>} />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={s.key === 'actual' ? 2.5 : 2} strokeDasharray={s.dash} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-2">Each point is a forecast made 4 weeks earlier. Hover to read values.</p>
      </Card>

      <Card title="What the model relies on most (top 10 by gain)">
        <div className="w-full" style={{ height: imp.data.length * 34 + 20 }}>
          <ResponsiveContainer>
            <BarChart data={imp.data.map((d) => ({ ...d, pct: Math.round(d.importance * 1000) / 10 }))} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="label" width={230} tick={{ fontSize: 12, fill: '#4b5560' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [`${String(v)}% of total gain`, 'Importance']} cursor={{ fill: '#f1f3f5' }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e6ea' }} />
              <Bar dataKey="pct" fill="#2a78d6" radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                <LabelList dataKey="pct" position="right" formatter={(v) => `${String(v)}%`} style={{ fontSize: 12, fill: '#4b5560' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-ink-2">Share of the model's total split gain, for the model in use.</p>
      </Card>

      {early && (
        <Card title="Subzone ranking: early check">
          <p className="max-w-3xl text-sm leading-relaxed text-ink">The subzone ranking is a rule-based index, not a prediction, and is not validated. As an early check we count new clusters since {early.since} and whether their subzone was flagged the week before. Of {early.new_clusters} new clusters, the current method had {early.new_method?.in_high_prior_week ?? 'n/a'} in a High subzone and {early.new_method?.in_high_or_elevated_prior_week ?? 'n/a'} in High or Elevated. The previous method had {early.in_high_prior_week} and {early.in_high_or_elevated_prior_week}. A sample of {early.new_clusters} is far too small to conclude anything.</p>
          <p className="mt-2 text-xs text-ink-2">{early.note}</p>
        </Card>
      )}

      <Card title="Limitations">
        <ul className="max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-ink">
          <li><strong>Island-wide only.</strong> The forecast says nothing about which neighbourhoods will see cases.</li>
          <li><strong>Serotype shifts and immunity are not observed.</strong> Large outbreaks often follow a switch in the dominant dengue serotype; the model cannot see this, which is one reason outbreaks are hard to call early.</li>
          <li><strong>The subzone index is rule-based.</strong> It combines cluster proximity, rainfall and temperature with fixed weights. It has not been validated against where clusters appear later.</li>
          <li><strong>Weather comes from limited stations.</strong> The forecast uses Changi only, and each subzone uses its nearest station with data, which can be several kilometres away.</li>
          <li><strong>Case counts change.</strong> Recent weeks come from NEA's published figures, which can be revised, and differ slightly from the MOH bulletin used for training.</li>
          <li><strong>Interventions are not modelled</strong>, such as Project Wolbachia releases or intensified vector control.</li>
        </ul>
      </Card>
    </div>
  )
}
