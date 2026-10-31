import { NavLink, Outlet } from 'react-router-dom'
import { apiPost } from '../lib/api'
import { useData } from '../lib/data'
import { dateLabel, weekLabel } from '../lib/format'
import type { Meta } from '../types'
import RefreshButton from './RefreshButton'
import { Disclaimer } from './ui'

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 text-sm font-medium ${isActive ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-accent-soft hover:text-accent'}`

const STEPS = [
  { to: '/', label: 'Plan', hint: 'Draft and confirm the week' },
  { to: '/inspect', label: 'Inspect', hint: 'On site: checklist and reports' },
  { to: '/review', label: 'Review', hint: 'Weekly summary and repeat sites' },
]

async function resetDemo() {
  if (!window.confirm('Reset your demo? This removes your re-plans, chat, reports and photos. Other visitors are not affected.')) return
  try {
    await apiPost('session', { action: 'reset' })
    window.location.hash = '#/'
    window.location.reload()
  } catch (e) {
    window.alert(`Could not reset: ${(e as Error).message}`)
  }
}

export default function Layout() {
  const { data: meta } = useData<Meta>('meta.json')
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div>
            <p className="text-xl font-bold tracking-tight text-accent">DengueRadar <span className="font-semibold text-ink">Copilot</span></p>
            <p className="text-sm text-ink-2">An AI agent that runs a dengue inspection team’s week</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {meta && (
              <p className="text-xs text-ink-2">
                Updated {dateLabel(meta.generated_at)} · {weekLabel(meta.epi_week)}
              </p>
            )}
            <RefreshButton current={meta?.generated_at} />
            <button onClick={resetDemo} title="Remove your re-plans, chat, reports and photos, and return to this week’s default plan"
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-2 hover:bg-accent-soft">↺ Reset demo</button>
            <nav className="flex gap-1" aria-label="Data and method">
              <NavLink to="/map" className={link}>Risk map</NavLink>
              <NavLink to="/model" className={link}>Model</NavLink>
              <NavLink to="/about" className={link}>About</NavLink>
            </nav>
          </div>
        </div>
        <nav aria-label="Workflow" className="border-t border-line">
          <ol className="mx-auto grid max-w-7xl grid-cols-3 px-2 sm:px-4">
            {STEPS.map((s, i) => (
              <li key={s.to}>
                <NavLink to={s.to} end className={({ isActive }) =>
                  `flex items-center gap-2 border-b-2 px-2 py-2.5 sm:px-3 ${isActive ? 'border-accent text-accent' : 'border-transparent text-ink-2 hover:text-accent'}`}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-current text-xs font-semibold">{i + 1}</span>
                  <span>
                    <span className="block text-sm font-semibold">{s.label}</span>
                    <span className="hidden text-xs text-ink-3 sm:block">{s.hint}</span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ol>
        </nav>
        <div className="border-t border-line bg-accent-soft">
          <p className="mx-auto max-w-7xl px-4 py-1.5 text-xs text-ink">
            <strong>Student prototype.</strong> Not an official NEA tool. Island-wide forecast; rule-based subzone index; premises and inspection records are demo data.
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Outlet />
      </main>
      <footer className="no-print border-t border-line bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <Disclaimer />
          <p className="mt-2 text-xs text-ink-3">
            Contains information from data.gov.sg, NEA, MOH, MSS, URA and SingStat accessed under the Singapore Open Data Licence.
          </p>
        </div>
      </footer>
    </div>
  )
}
