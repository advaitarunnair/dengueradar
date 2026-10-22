import { HABITAT_TYPES, type ReportDraft } from '../../copilot'

/** The inspector reviews and edits the model's draft before anything is saved. */
export default function ReportEditor({ draft, onChange }: { draft: ReportDraft; onChange: (d: ReportDraft) => void }) {
  const set = (patch: Partial<ReportDraft>) => onChange({ ...draft, ...patch })
  const setHabitat = (i: number, patch: Partial<ReportDraft['habitats'][number]>) => {
    const habitats = draft.habitats.map((h, j) => (j === i ? { ...h, ...patch } : h))
    set({ habitats, breeding_found: habitats.some((h) => h.breeding) })
  }
  const input = 'w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink'
  return (
    <div className="space-y-3 text-sm">
      {draft.missing.length > 0 && (
        <p className="rounded-md bg-accent-soft px-3 py-2 text-ink">⚠ Not in your notes, please fill in if relevant: {draft.missing.join(', ')}</p>
      )}
      <label className="block"><span className="text-xs text-ink-2">Location</span>
        <input className={input} value={draft.location} onChange={(e) => set({ location: e.target.value })} /></label>
      <fieldset className="space-y-2">
        <legend className="text-xs text-ink-2">Habitats checked</legend>
        {draft.habitats.map((h, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-line p-2 sm:grid-cols-[1.4fr_1fr_70px_auto_auto]">
            <select className={input} value={HABITAT_TYPES.includes(h.type) ? h.type : 'other'} onChange={(e) => setHabitat(i, { type: e.target.value })} aria-label="Habitat type">
              {!HABITAT_TYPES.includes(h.type) && <option value="other">{h.type}</option>}
              {HABITAT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className={input} placeholder="Where" value={h.location ?? ''} onChange={(e) => setHabitat(i, { location: e.target.value })} aria-label="Where" />
            <input className={input} type="number" min={0} placeholder="Count" value={h.count ?? ''} onChange={(e) => setHabitat(i, { count: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Count" />
            <label className="flex items-center gap-1.5 whitespace-nowrap"><input type="checkbox" checked={h.breeding} onChange={(e) => setHabitat(i, { breeding: e.target.checked })} /> Breeding</label>
            <button type="button" className="text-xs text-ink-2 underline" onClick={() => set({ habitats: draft.habitats.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button type="button" className="text-xs text-accent underline" onClick={() => set({ habitats: [...draft.habitats, { type: 'other', location: null, breeding: false, count: null }] })}>+ Add habitat</button>
      </fieldset>
      <p className="text-ink">Breeding found: <strong>{draft.breeding_found ? 'Yes' : 'No'}</strong> <span className="text-xs text-ink-3">(from the habitats above)</span></p>
      <label className="block"><span className="text-xs text-ink-2">Actions taken</span>
        <textarea className={input} rows={2} value={draft.actions_taken} onChange={(e) => set({ actions_taken: e.target.value })} /></label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.follow_up_needed} onChange={(e) => set({ follow_up_needed: e.target.checked })} /> Follow-up needed</label>
        <label><span className="block text-xs text-ink-2">Due</span>
          <input type="date" className={input} value={draft.follow_up_due ?? ''} onChange={(e) => set({ follow_up_due: e.target.value || null })} /></label>
      </div>
      <label className="block"><span className="text-xs text-ink-2">Summary for the record</span>
        <textarea className={input} rows={2} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} /></label>
    </div>
  )
}
