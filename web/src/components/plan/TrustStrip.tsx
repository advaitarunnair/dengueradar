import { Link } from 'react-router-dom'
import { useData } from '../../lib/data'
import type { ModelEval } from '../../types'

/** One honest line on how far to trust the forecast and ranking. The full detail is on the Model page. */
export default function TrustStrip() {
  const { data: ev } = useData<ModelEval>('model_eval.json')
  if (!ev) return null
  const all = ev.metrics.all_test_weeks
  const adopted = ev.experiments?.adopted
  const used = adopted ? all[adopted] : all.model
  return (
    <p className="text-xs text-ink-2">
      {adopted
        ? <>Forecast is indicative: on {ev.test.n_weeks} unseen weeks its average error beat a simple “same as this week” rule ({used?.mae?.toFixed(0)} vs {all.persistence.mae?.toFixed(0)} cases a week), by a modest margin.</>
        : <>Forecast is indicative: on {ev.test.n_weeks} unseen weeks it did not beat a simple “same as this week” rule.</>}
      {' '}The subzone ranking is a rule-based index, not yet validated. <Link to="/model" className="text-accent underline">Details →</Link>
    </p>
  )
}
