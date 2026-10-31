import type { GeoJSON as LGeoJSON, LatLngBoundsExpression } from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { teamColor, type Plan } from '../../copilot'
import { titleCase } from '../../lib/format'
import type { ScoresCollection, SubzoneFeature } from '../../types'

function FocusArea({ plan, selectedId }: { plan: Plan; selectedId: string | null }) {
  const map = useMap()
  useEffect(() => {
    const a = plan.areas.find((x) => x.subzone_id === selectedId)
    if (a) map.flyTo([a.lat, a.lon], 14, { duration: 0.6 })
  }, [selectedId, plan, map])
  return null
}

/** Plan areas coloured by team, with each team's visiting order (nearest neighbour) drawn as a route. */
export default function PlanMap({ plan, scores, selectedId, onSelect }: { plan: Plan; scores: ScoresCollection; selectedId: string | null; onSelect: (id: string) => void }) {
  const ref = useRef<LGeoJSON | null>(null)
  const byId = useMemo(() => new Map(plan.areas.map((a) => [a.subzone_id, a])), [plan])
  const features = useMemo(
    () => ({ ...scores, features: scores.features.filter((f) => byId.has(f.properties.subzone_id)) }),
    [scores, byId],
  )
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const lats = plan.areas.map((a) => a.lat), lons = plan.areas.map((a) => a.lon)
    return lats.length ? [[Math.min(...lats) - 0.01, Math.min(...lons) - 0.01], [Math.max(...lats) + 0.01, Math.max(...lons) + 0.01]] : [[1.22, 103.62], [1.47, 104.03]]
  }, [plan])
  return (
    <MapContainer bounds={bounds} zoomSnap={0.25} className="h-[320px] w-full rounded-lg sm:h-[420px]" scrollWheelZoom={false}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' opacity={0.7} />
      <GeoJSON
        key={plan.generated_at + (selectedId ?? '')}
        ref={ref}
        data={features}
        style={(f) => {
          const a = byId.get((f as SubzoneFeature).properties.subzone_id)!
          const sel = a.subzone_id === selectedId
          return { color: sel ? '#14181d' : teamColor(plan, a.team), weight: sel ? 3 : 2, fillColor: teamColor(plan, a.team), fillOpacity: sel ? 0.45 : 0.25 }
        }}
        onEachFeature={(f, layer) => {
          const a = byId.get((f as SubzoneFeature).properties.subzone_id)!
          layer.bindTooltip(`<strong>${a.order}. ${titleCase(a.subzone)}</strong><br/>${a.team} · ${a.premises} premises`, { sticky: true })
          layer.on('click', () => onSelect(a.subzone_id))
        }}
      />
      {plan.teams.flatMap((t) =>
        t.days.map((d) => (
          <Polyline key={`${t.name}-${d.day}`} positions={d.stops.map((s) => [s.lat, s.lon] as [number, number])}
            pathOptions={{ color: teamColor(plan, t.name), weight: 2, opacity: 0.9, dashArray: d.day % 2 ? undefined : '4 4' }} />
        )),
      )}
      {plan.teams.flatMap((t) =>
        t.days.flatMap((d) =>
          d.stops.map((s, i) => (
            <CircleMarker key={s.premises_id} center={[s.lat, s.lon]} radius={4}
              pathOptions={{ color: '#ffffff', weight: 1.5, fillColor: teamColor(plan, t.name), fillOpacity: 1 }}>
              <Tooltip>{t.name}, day {d.day}, stop {i + 1}: {s.name}</Tooltip>
            </CircleMarker>
          )),
        ),
      )}
      <FocusArea plan={plan} selectedId={selectedId} />
    </MapContainer>
  )
}
