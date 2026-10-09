import { normalise, sameWeights } from '../lib/scoring'
import type { Component, Weights } from '../types'
import { Card } from './ui'

const LABELS: Record<Component, string> = { spread: 'Cluster proximity', rain: 'Rainfall 2 to 8 weeks ago', temp: 'Temperature, last 4 weeks' }

export default function WeightSliders({ weights, defaults, onChange }: { weights: Weights; defaults: Weights; onChange: (w: Weights) => void }) {
  const shares = normalise(weights)
  const changed = !sameWeights(weights, defaults)
  return (
    <Card
      title="Risk weights"
      className="no-print"
      action={<button onClick={() => onChange(defaults)} disabled={!changed} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft disabled:text-ink-3 disabled:hover:bg-white">Reset to defaults</button>}
    >
      <div className="space-y-3">
        {(Object.keys(LABELS) as Component[]).map((k) => (
          <label key={k} className="block text-sm text-ink">
            <span className="flex justify-between">
              <span>{LABELS[k]}</span>
              <span className="tabular-nums text-ink-2">{Math.round(shares[k] * 100)}%</span>
            </span>
            <input type="range" min={0} max={100} step={5} value={Math.round(weights[k] * 100)} onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) / 100 })} className="mt-1 w-full accent-accent" />
          </label>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-2">Weights are rescaled to add up to 100%. Risk, bands and the list update in your browser only.</p>
      {changed && <p role="note" className="mt-2 rounded-md border border-line bg-accent-soft px-3 py-2 text-xs text-ink">⚠ Custom weights in use. Bands and ranks differ from the published defaults, and week-on-week changes are hidden.</p>}
    </Card>
  )
}
