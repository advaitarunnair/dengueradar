import { Link } from 'react-router-dom'
import { num, weekLabel } from '../lib/format'
import type { Meta } from '../types'
import { Card, outlookIcon } from './ui'

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="text-3xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="text-xs text-ink-2">{sub}</p>
    </div>
  )
}

export default function OutlookCard({ meta }: { meta: Meta }) {
  const sign = meta.pct_change > 0 ? '+' : ''
  const share = meta.scoring.bands[meta.outlook].high * 100
  return (
    <Card title="4-week outlook (island-wide)">
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <Stat label="Forecast in 4 weeks" value={num(meta.forecast_cases)} sub={`cases per week · ${weekLabel(meta.forecast_week)}`} />
          <Stat label="Current" value={num(meta.current_cases)} sub={`cases per week · ${weekLabel(meta.case_week)}`} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Outlook</p>
            <p className="text-3xl font-semibold text-accent">
              <span aria-hidden>{outlookIcon(meta.outlook)}</span> {meta.outlook}
            </p>
            <p className="text-xs text-ink-2">
              {sign}
              {meta.pct_change}% vs current · top {share}% of subzones flagged High
            </p>
          </div>
        </div>
        <div className="border-line lg:border-l lg:pl-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Top drivers of this forecast</p>
          <ul className="mt-1 space-y-1 text-sm text-ink">
            {meta.drivers.map((d) => (
              <li key={d.label} className="flex gap-2">
                <span aria-hidden className="text-ink-2">{d.direction === 'up' ? '▲' : '▼'}</span>
                <span>{d.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-2">Drivers are patterns the model learned from past data, not causes.</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-2">
        Outlook is Rising or Falling when the forecast is at least {meta.outlook_threshold_pct}% above or below current cases. Read it as indicative: its lead over a simple “same as this week” rule on unseen years is modest.{' '}
        <Link to="/model" className="font-medium text-accent underline">See how it performs</Link>
      </p>
      {meta.case_data.manual_topup_used && (
        <p role="note" className="mt-2 rounded-md border border-line bg-accent-soft px-3 py-2 text-xs text-ink">
          ⚠ Recent weekly case counts were entered by hand from NEA's published figures because the official dataset lags.
        </p>
      )}
    </Card>
  )
}
