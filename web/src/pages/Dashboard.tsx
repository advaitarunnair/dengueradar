import { useMemo, useState } from 'react'
import InspectionList from '../components/InspectionList'
import OutlookCard from '../components/OutlookCard'
import RiskMap from '../components/RiskMap'
import SubzoneCard from '../components/SubzoneCard'
import { Card, Status } from '../components/ui'
import WeightSliders from '../components/WeightSliders'
import { useData } from '../lib/data'
import { rescore, sameWeights } from '../lib/scoring'
import type { ClustersCollection, Meta, ScoresCollection, Weights } from '../types'

export default function Dashboard() {
  const meta = useData<Meta>('meta.json')
  const scores = useData<ScoresCollection>('scores.geojson')
  const clusters = useData<ClustersCollection>('clusters.geojson')
  const [custom, setCustom] = useState<Weights | null>(null)
  const [capacity, setCapacity] = useState(20)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [flyKey, setFlyKey] = useState(0)

  const defaults = meta.data?.scoring.weights
  const weights = custom ?? defaults
  const scored = useMemo(() => {
    if (!scores.data || !meta.data || !weights) return new Map()
    return rescore(scores.data.features.map((f) => f.properties), weights, meta.data.outlook, meta.data.scoring.bands)
  }, [scores.data, meta.data, weights]) as ReturnType<typeof rescore>
  const ranked = useMemo(() => [...scored.values()].sort((a, b) => a.rank - b.rank), [scored])

  const error = meta.error ?? scores.error ?? clusters.error
  if (error || !meta.data || !scores.data || !clusters.data || !weights || !defaults) return <Status loading error={error} />

  const m = meta.data
  const customWeights = !sameWeights(weights, defaults)
  const selected = scores.data.features.find((f) => f.properties.subzone_id === selectedId)?.properties ?? null
  const counts = { High: 0, Elevated: 0, Low: 0 }
  ranked.forEach((r) => (counts[r.band] += 1))

  return (
    <div className="space-y-5">
      <div className="no-print"><OutlookCard meta={m} /></div>
      <div id="map-top" className="no-print grid scroll-mt-4 gap-5 lg:grid-cols-[1fr_340px]">
        <Card title="Subzone risk map" action={<p className="text-xs text-ink-2">{counts.High} High · {counts.Elevated} Elevated · {counts.Low} Low · {m.active_clusters} active clusters ({m.cluster_cases} cases)</p>}>
          <RiskMap scores={scores.data} clusters={clusters.data} scored={scored} selectedId={selectedId} flyKey={flyKey} onSelect={setSelectedId} />
        </Card>
        <div className="space-y-5">
          <SubzoneCard props={selected} scored={selectedId ? scored.get(selectedId) : undefined} showChange={!customWeights} onClose={() => setSelectedId(null)} />
          <WeightSliders weights={weights} defaults={defaults} onChange={setCustom} />
        </div>
      </div>
      <InspectionList
        rows={ranked.slice(0, capacity)}
        capacity={capacity}
        onCapacity={setCapacity}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id)
          setFlyKey((k) => k + 1)
          document.getElementById('map-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        meta={m}
        customWeights={customWeights}
      />
    </div>
  )
}
