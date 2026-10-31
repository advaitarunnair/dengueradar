import { useState } from 'react'
import { titleCase } from '../../lib/format'
import type { Plan } from '../../copilot'

/**
 * Shows the verifier's work. The agent names data keys and code writes the numbers, so they cannot be mixed up
 * between areas; anything the model wrote with a number in it is removed and listed here.
 */
export default function VerifierPanel({ plan }: { plan: Plan }) {
  const [open, setOpen] = useState(false)
  const c = plan.checks
  const corrections = c.corrections ?? []
  const removed = c.removed_sentences ?? []
  const fixed = corrections.length + removed.length
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-accent hover:text-accent">
        ✓ {c.numbers_checked} numbers checked{fixed ? ` · ${fixed} corrected` : ''} <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-line bg-page p-3 text-xs text-ink-2">
          <p>The agent chooses which facts matter for each area by naming data keys. Code then writes the numbers from that area’s own data, so a figure can’t land on the wrong area. Any text the model wrote containing a number is rewritten without it or removed, and listed here.</p>
          <div>
            <p className="font-semibold text-ink">Corrected in this version ({fixed})</p>
            {fixed === 0 && <p>Nothing needed correcting.</p>}
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {removed.map((r, i) => <li key={`s${i}`}><strong>Summary sentence removed:</strong> “{r}”</li>)}
              {corrections.map((x, i) => {
                const rewritten = x.where.endsWith('rewritten; original')
                const where = titleCase(x.where.replace(' rewritten; original', '').replace(/ (note|focus)$/, '')) + (x.where.includes(' focus') ? ' focus' : x.where.includes(' note') ? ' note' : '')
                return <li key={`c${i}`}><strong>{where}</strong> {rewritten ? 'rewritten without figures. Original:' : 'removed:'} “{x.removed}”</li>
              })}
            </ul>
          </div>
          {c.dropped.length > 0 && (
            <div>
              <p className="font-semibold text-ink">Left out by checks ({c.dropped.length})</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{c.dropped.map((d) => <li key={d.subzone_id}><strong>{titleCase(d.subzone_id.replace(/-/g, ' '))}:</strong> {d.why}</li>)}</ul>
            </div>
          )}
          {(c.rendered?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-ink">Keys chosen by the agent, numbers written by code</p>
              <ul className="mt-1 space-y-1">
                {c.rendered!.map((r) => <li key={r.subzone}><strong>{titleCase(r.subzone)}</strong> <code className="text-ink-3">{r.factors.join(', ')}</code><br />{r.text}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
