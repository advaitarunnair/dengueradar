import type { ReactNode } from 'react'
import type { Band, Outlook } from '../types'

export const BAND_COLOR: Record<Band, string> = { High: '#d03b3b', Elevated: '#fab219', Low: '#0ca30c' }
const BAND_ICON: Record<Band, string> = { High: '▲', Elevated: '◆', Low: '●' }

/** Band shown with an icon and a label, never colour alone. */
export function BandBadge({ band }: { band: Band }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-white px-2 py-0.5 text-xs font-medium text-ink">
      <span aria-hidden style={{ color: BAND_COLOR[band] }}>{BAND_ICON[band]}</span>
      {band}
    </span>
  )
}

export function Card({ title, children, className = '', action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`print-plain rounded-xl border border-line bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function Status({ loading, error }: { loading: boolean; error: string | null }) {
  if (error)
    return (
      <div role="alert" className="rounded-xl border border-line bg-white p-6 text-sm text-ink">
        <p className="font-semibold">⚠ Could not load data</p>
        <p className="mt-1 text-ink-2">{error}. Try reloading the page.</p>
      </div>
    )
  if (loading)
    return (
      <div role="status" className="rounded-xl border border-line bg-white p-6 text-sm text-ink-2">
        Loading data…
      </div>
    )
  return null
}

const OUTLOOK_ICON: Record<Outlook, string> = { Rising: '↗', Stable: '→', Falling: '↘' }
export const outlookIcon = (o: Outlook) => OUTLOOK_ICON[o]

export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-ink-2 ${className}`}>
      <strong>Student prototype, not an official NEA tool.</strong> Plans, checklists, reports and briefings are drafted by AI and must be
      checked by an officer. The forecast is island-wide, not per subzone. The subzone
      ranking is a transparent rule-based index, not a prediction, and has not been validated against future clusters. Do not use
      it for health or operational decisions without official NEA information.
    </p>
  )
}

/** Rank movement against last week: positive means the subzone moved up the list. */
export function RankChange({ change }: { change: number | null }) {
  if (change === null) return <span className="text-ink-3" title="No earlier week to compare with">–</span>
  if (change === 0) return <span className="text-ink-3" title="No change">＝</span>
  const up = change > 0
  return (
    <span className="whitespace-nowrap text-ink-2" title={`${up ? 'Up' : 'Down'} ${Math.abs(change)} places since last week`}>
      {up ? '▲' : '▼'} {Math.abs(change)}
    </span>
  )
}

/** Marks anything built on the prototype's fictional premises and inspection records. */
export function DemoBadge({ children = 'Demo data' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-ink-3 px-2.5 py-1 text-xs text-ink-2" title="Fictional premises and inspection records, placed inside real subzones, for demonstrating the Copilot. Forecasts and rankings use real data.">
      <span aria-hidden>◌</span> {children}
    </span>
  )
}
