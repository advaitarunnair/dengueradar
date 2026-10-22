import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Disclaimer, Status } from '../components/ui'
import type { PlanRecord } from '../copilot'
import { apiGet } from '../lib/api'
import { titleCase, weekLabel } from '../lib/format'

const TYPE: Record<string, string> = {
  hdb_block: 'HDB block', landed_home: 'Landed homes', condo: 'Condominium', construction_site: 'Construction site',
  school: 'School', market: 'Market / food centre', park: 'Park',
}

/** Printable, shareable team sheets for one plan version: day-by-day visiting order per team. */
export default function PlanPrint() {
  const { id } = useParams()
  const [record, setRecord] = useState<PlanRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { apiGet<{ record: PlanRecord }>(`plan?id=${id}`).then((r) => setRecord(r.record)).catch((e: Error) => setError(e.message)) }, [id])
  if (!record) return <Status loading={!error} error={error} />
  const p = record.plan
  return (
    <article className="mx-auto max-w-4xl space-y-6 bg-white p-4 text-ink sm:p-8">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to="/" className="text-sm text-accent underline">← Back to plan</Link>
        <div className="flex gap-2">
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)} className="rounded-md border border-line px-3 py-1.5 text-sm text-accent">Copy link</button>
          <button onClick={() => window.print()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">Print / save as PDF</button>
        </div>
      </div>
      <header>
        <h1 className="text-2xl font-bold">Dengue inspection plan · {weekLabel(record.epi_week)}</h1>
        <p className="text-sm text-ink-2">
          {record.status === 'confirmed' ? 'Confirmed' : 'DRAFT, not yet confirmed'} · version {record.version} · drafted by the DengueRadar Copilot (Nemotron Ultra) ·
          island-wide forecast {p.outlook.forecast_cases} cases for {weekLabel(p.outlook.forecast_week)} ({p.outlook.outlook})
        </p>
        <p className="mt-2 text-sm">{p.summary}</p>
      </header>
      {p.teams.filter((t) => t.premises > 0).map((t) => (
        <section key={t.name} className="break-inside-avoid-page space-y-3 border-t border-line pt-4">
          <h2 className="text-lg font-semibold">{t.name} · {t.regions.map(titleCase).join(' + ')} · {t.premises} premises</h2>
          <ul className="space-y-1 text-sm">
            {p.areas.filter((a) => a.team === t.name).map((a) => (
              <li key={a.subzone_id}><strong>{titleCase(a.subzone)}</strong> ({a.band}, rank {a.rank}): {a.reason}{a.focus ? ` Focus: ${a.focus}` : ''}</li>
            ))}
          </ul>
          {t.days.map((d) => (
            <table key={d.day} className="w-full border-collapse text-left text-sm">
              <caption className="pb-1 text-left text-sm font-semibold">Day {d.day} · {d.stops.length} stops · about {d.km} km between stops</caption>
              <thead><tr className="border-b border-line text-xs text-ink-3"><th className="w-10 py-1">#</th><th>Premises (demo)</th><th>Type</th><th>Subzone</th><th className="w-24">Done</th></tr></thead>
              <tbody>
                {d.stops.map((s, i) => (
                  <tr key={s.premises_id} className="border-b border-line">
                    <td className="py-1 tabular-nums">{i + 1}</td><td>{s.name}</td><td>{TYPE[s.premises_type] ?? s.premises_type}</td>
                    <td>{titleCase(p.areas.find((a) => a.subzone_id === s.subzone_id)?.subzone ?? s.subzone_id)}</td><td>☐</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </section>
      ))}
      <footer className="border-t border-line pt-3"><Disclaimer /></footer>
    </article>
  )
}
