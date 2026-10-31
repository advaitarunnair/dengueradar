import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Dictation from '../components/inspect/Dictation'
import PhotoEvidence from '../components/inspect/PhotoEvidence'
import ReportEditor from '../components/inspect/ReportEditor'
import { Card, DemoBadge, Status } from '../components/ui'
import { PREMISES_TYPE, type ChecklistItem, type PremisesDetail, type ReportDraft } from '../copilot'
import { apiGet, apiPost } from '../lib/api'
import { dateLabel } from '../lib/format'

const INSPECTOR_KEY = 'dengueradar-inspector'
const store = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ''; localStorage.setItem(k, v) } catch { /* optional */ } return v ?? '' }

/** One premises on site: history, tailored checklist (Nano), notes -> report (Super), edit, save. */
export default function InspectPremises() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const team = params.get('team')
  const [detail, setDetail] = useState<PremisesDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ChecklistItem[] | null>(null)
  const [checklistNotice, setChecklistNotice] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [checklistError, setChecklistError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [inspector, setInspector] = useState(() => store(INSPECTOR_KEY) as string)
  const [draft, setDraft] = useState<ReportDraft | null>(null)
  const [busy, setBusy] = useState<'draft' | 'save' | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [photoIds, setPhotoIds] = useState<number[]>([])

  useEffect(() => {
    apiGet<PremisesDetail>(`inspect?premises=${id}`).then(setDetail).catch((e: Error) => setError(e.message))
    apiPost<{ items: ChecklistItem[]; notice?: string }>('inspect', { action: 'checklist', premises_id: Number(id) })
      .then((r) => { setItems(r.items); setChecklistNotice(r.notice ?? null) }).catch((e: Error) => setChecklistError(e.message))
  }, [id])

  const makeDraft = async () => {
    setBusy('draft'); setError(null)
    try { setDraft(await apiPost<ReportDraft>('inspect', { action: 'draft', premises_id: Number(id), notes, inspector })) }
    catch (e) {
      setError(`${(e as Error).message} You can still fill in the report by hand below.`)
      setDraft({ location: detail?.premises.name ?? '', habitats: [], breeding_found: false, actions_taken: '', follow_up_needed: false, follow_up_due: null, summary: '', missing: [] })
    }
    finally { setBusy(null) }
  }
  const save = async () => {
    if (!draft) return
    setBusy('save'); setError(null)
    try {
      const r = await apiPost<{ id: number }>('inspect', { action: 'save', premises_id: Number(id), team_name: team, inspector, notes_raw: notes, report: draft, photo_ids: photoIds })
      setSaved(r.id)
      apiGet<PremisesDetail>(`inspect?premises=${id}`).then(setDetail)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(null) }
  }

  if (!detail) return <Status loading={!error} error={error} />
  const p = detail.premises
  const breedingCount = detail.history.filter((h) => h.breeding_found).length
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link to="/inspect" className="text-sm text-accent underline">← All visits</Link>
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Step 2 · Inspect{team ? ` · ${team}` : ''}</p>
        <h1 className="text-xl font-semibold text-ink">{p.name}</h1>
        <p className="mt-1 text-sm text-ink-2">{PREMISES_TYPE[p.premises_type] ?? p.premises_type}{p.layout_notes ? ` · ${p.layout_notes}` : ''}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {p.is_demo && <DemoBadge>Demo premises</DemoBadge>}
          {breedingCount >= 2 && <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-ink">▲ Breeding found on {breedingCount} of the last {detail.history.length} visits</span>}
        </div>
        {detail.history.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-2">Past inspections ({detail.history.length})</summary>
            <ul className="mt-2 space-y-1">
              {detail.history.map((h) => (
                <li key={h.id} className="text-ink">
                  <span className="text-ink-2">{dateLabel(h.inspected_on)}:</span> {h.breeding_found ? '▲ breeding' : 'no breeding'} ·{' '}
                  {h.habitats.map((x) => `${x.type}${x.breeding ? ' (larvae)' : ''}`).join(', ')}
                  {h.follow_up_needed && !h.follow_up_done ? ' · follow-up open' : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Site checklist" action={<span className="text-xs text-ink-3">Nemotron Nano · tailored to this premises</span>}>
        {checklistError && <p className="text-sm text-ink">⚠ {checklistError}</p>}
        {!items && !checklistError && <p className="text-sm text-ink-2">Preparing checklist…</p>}
        {checklistNotice && <p className="mb-2 rounded-md bg-accent-soft px-3 py-2 text-xs text-ink">{checklistNotice}</p>}
        {items && (
          <ul className="space-y-1.5">
            {items.map((it, i) => (
              <li key={i}>
                <label className="flex gap-3 rounded-md px-1 py-1.5 hover:bg-accent-soft">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ticked.has(i)}
                    onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(i)) n.delete(i); else n.add(i); return n })} />
                  <span className="text-sm">
                    <span className="font-medium text-ink">{it.priority === 'high' && <span aria-label="High priority">▲ </span>}{it.habitat}</span>
                    <span className="block text-ink">{it.check}</span>
                    <span className="block text-xs text-ink-2">{it.why}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {items && <p className="mt-2 text-xs text-ink-3">{ticked.size} of {items.length} checked</p>}
      </Card>

      <Card title="Photo evidence" action={<span className="text-xs text-ink-3">Nemotron VL</span>}>
        <PhotoEvidence premisesId={p.id} fallback={{ lat: p.lat, lon: p.lon }} onNewIds={setPhotoIds} />
        {photoIds.length > 0 && !saved && <p className="mt-2 text-xs text-ink-2">{photoIds.length} new photo(s) will be attached to the report when you save it.</p>}
      </Card>

      <Card title="Field notes → report" action={<span className="text-xs text-ink-3">Nemotron Super</span>}>
        {saved ? (
          <div className="space-y-2 text-sm">
            <p className="rounded-md bg-accent-soft px-3 py-2 text-ink">✓ Report #{saved} saved. It now counts in this week’s review.</p>
            <Link to="/inspect" className="inline-block text-accent underline">Next visit →</Link>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm"><span className="text-xs text-ink-2">Inspector</span>
              <input value={inspector} onChange={(e) => { setInspector(e.target.value); store(INSPECTOR_KEY, e.target.value) }} placeholder="Your name"
                className="w-full rounded-md border border-line px-2 py-1.5 text-ink" /></label>
            <label className="block text-sm"><span className="text-xs text-ink-2">Notes: type or dictate, rough is fine</span>
              <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. lvl 7 corridor 3 flower pot plates w larvae unit 07-123, told owner to tip, applied larvicide. roof gutter choked no larvae. come back in a week"
                className="w-full rounded-md border border-line px-3 py-2 text-ink" /></label>
            <div className="flex flex-wrap items-center gap-2">
              <Dictation onText={(t) => setNotes((n) => (n ? `${n} ${t}` : t))} />
              <button onClick={makeDraft} disabled={busy !== null || notes.trim().length < 5}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {busy === 'draft' ? 'Writing report…' : draft ? 'Redraft from notes' : 'Draft formal report'}
              </button>
            </div>
            {draft && (
              <div className="space-y-3 border-t border-line pt-3">
                <p className="text-xs text-ink-2">Check and edit the draft. Nothing is saved until you press Save.</p>
                <ReportEditor draft={draft} onChange={setDraft} />
                <button onClick={save} disabled={busy !== null}
                  className="w-full rounded-md bg-accent px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
                  {busy === 'save' ? 'Saving…' : 'Save report'}
                </button>
              </div>
            )}
            {error && <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-ink">⚠ {error}</p>}
          </div>
        )}
      </Card>
    </div>
  )
}
