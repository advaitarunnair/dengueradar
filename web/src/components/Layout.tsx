import { NavLink, Outlet } from 'react-router-dom'
import { useData } from '../lib/data'
import { dateLabel, weekLabel } from '../lib/format'
import type { Meta } from '../types'
import { Disclaimer } from './ui'

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-accent text-white' : 'text-ink-2 hover:bg-accent-soft hover:text-accent'}`

export default function Layout() {
  const { data: meta } = useData<Meta>('meta.json')
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <div>
            <p className="text-xl font-bold tracking-tight text-accent">DengueRadar</p>
            <p className="text-sm text-ink-2">Weekly dengue inspection priorities for Singapore</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {meta && (
              <p className="text-xs text-ink-2">
                Updated {dateLabel(meta.generated_at)} · {weekLabel(meta.epi_week)}
              </p>
            )}
            <nav className="flex gap-1" aria-label="Main">
              <NavLink to="/" end className={link}>Dashboard</NavLink>
              <NavLink to="/model" className={link}>Model</NavLink>
              <NavLink to="/about" className={link}>About</NavLink>
            </nav>
          </div>
        </div>
        <div className="border-t border-line bg-accent-soft">
          <p className="mx-auto max-w-7xl px-4 py-1.5 text-xs text-ink">
            <strong>Student prototype.</strong> Not an official NEA tool. Island-wide forecast; rule-based subzone index.
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
