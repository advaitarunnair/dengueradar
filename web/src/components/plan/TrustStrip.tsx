import { Link } from 'react-router-dom'
import { useData } from '../../lib/data'
import type { ModelEval } from '../../types'

interface EarlyCheck { new_clusters: number; in_high_prior_week: number; in_high_or_elevated_prior_week: number; since: string | null }

/** Why (and how far) to trust the rankings: the forecast backtest as it is, and the index's early check. */
export default function TrustStrip() {
  const { data: ev } = useData<ModelEval>('model_eval.json')
  const { data: early } = useData<EarlyCheck>('ranking_check.json')
  if (!ev) return null
  const m = ev.metrics.all_test_weeks
  return (
    <div className="grid gap-3 text-xs text-ink-2 sm:grid-cols-2">
      <div className="rounded-lg border border-line bg-white p-3">
        <p className="font-semibold text-ink">Forecast backtest: {ev.test.n_weeks} unseen weeks</p>
        <p className="mt-1">
          Average error {m.model.mae.toFixed(0)} cases/week vs {m.persistence.mae.toFixed(0)} for a simple “same as this week” rule, which
          wins on error. The model calls the direction right {((m.model.direction_accuracy ?? 0) * 100).toFixed(0)}% of the time.{' '}
          <Link to="/model" className="text-accent underline">Details</Link>
        </p>
      </div>
      <div className="rounded-lg border border-line bg-white p-3">
        <p className="font-semibold text-ink">Subzone ranking: rule-based index, not yet validated</p>
        <p className="mt-1">
          {early && early.new_clusters > 0
            ? <>Early check: {early.in_high_prior_week} of {early.new_clusters} new cluster{early.new_clusters === 1 ? '' : 's'} since {early.since} appeared in a subzone flagged High the week before ({early.in_high_or_elevated_prior_week} in High or Elevated). A sample of {early.new_clusters} is far too small to conclude anything yet.</>
            : <>Early check starts once new clusters appear after the first weekly snapshot.</>}
        </p>
      </div>
    </div>
  )
}
