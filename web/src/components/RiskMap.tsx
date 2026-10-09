import type { GeoJSON as LGeoJSON, LatLngBounds, Layer, Path, PathOptions } from 'leaflet'
import { useEffect, useRef } from 'react'
import { GeoJSON, MapContainer, TileLayer, useMap } from 'react-leaflet'
import { titleCase } from '../lib/format'
import type { ClustersCollection, ScoredSubzone, ScoresCollection, SubzoneFeature } from '../types'
import { BAND_COLOR } from './ui'

interface Props {
  scores: ScoresCollection
  clusters: ClustersCollection
  scored: Map<string, ScoredSubzone>
  selectedId: string | null
  flyKey: number
  onSelect: (id: string) => void
}

const FILL_OPACITY = { High: 0.6, Elevated: 0.5, Low: 0.22 }

function styleFor(f: SubzoneFeature, scored: Map<string, ScoredSubzone>, selectedId: string | null): PathOptions {
  const s = scored.get(f.properties.subzone_id)
  const selected = f.properties.subzone_id === selectedId
  const base: PathOptions = s
    ? { fillColor: BAND_COLOR[s.band], fillOpacity: FILL_OPACITY[s.band] }
    : { fillColor: '#9aa3ad', fillOpacity: 0.08 }
  return { ...base, color: selected ? '#14181d' : '#ffffff', weight: selected ? 3 : 1, opacity: selected ? 1 : 0.9 }
}

function FlyToSelected({ layerRef, selectedId, flyKey }: { layerRef: React.RefObject<LGeoJSON | null>; selectedId: string | null; flyKey: number }) {
  const map = useMap()
  useEffect(() => {
    if (!selectedId || flyKey === 0) return
    layerRef.current?.eachLayer((l) => {
      const layer = l as Path & { feature?: SubzoneFeature; getBounds: () => LatLngBounds }
      if (layer.feature?.properties.subzone_id === selectedId) map.flyToBounds(layer.getBounds(), { maxZoom: 14, padding: [40, 40], duration: 0.8 })
    })
    // fly only when a list row asks for it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey])
  return null
}

export default function RiskMap({ scores, clusters, scored, selectedId, flyKey, onSelect }: Props) {
  const layerRef = useRef<LGeoJSON | null>(null)
  const latest = useRef({ scored, selectedId, onSelect })
  latest.current = { scored, selectedId, onSelect }

  useEffect(() => {
    layerRef.current?.eachLayer((l) => {
      const layer = l as Path & { feature?: SubzoneFeature }
      if (layer.feature) {
        layer.setStyle(styleFor(layer.feature, scored, selectedId))
        if (layer.feature.properties.subzone_id === selectedId) layer.bringToFront()
      }
    })
  }, [scored, selectedId])

  const onEach = (feature: SubzoneFeature, layer: Layer) => {
    const path = layer as Path
    path.bindTooltip(() => {
      const s = latest.current.scored.get(feature.properties.subzone_id)
      return `<strong>${titleCase(feature.properties.subzone)}</strong><br/>${s ? `${s.band} · rank ${s.rank}` : 'Not ranked (under 100 residents)'}`
    }, { sticky: true })
    path.on({
      mouseover: () => {
        path.setStyle({ weight: 3, color: '#14181d' })
        path.bringToFront()
      },
      mouseout: () => path.setStyle(styleFor(feature, latest.current.scored, latest.current.selectedId)),
      click: () => latest.current.onSelect(feature.properties.subzone_id),
    })
  }

  return (
    <div className="relative">
      <MapContainer bounds={[[1.22, 103.62], [1.47, 104.03]]} minZoom={10} maxZoom={17} scrollWheelZoom className="h-[420px] w-full rounded-lg sm:h-[520px]">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          opacity={0.75}
        />
        <GeoJSON
          ref={layerRef}
          data={scores}
          style={(f) => styleFor(f as SubzoneFeature, scored, selectedId)}
          onEachFeature={(f, l) => onEach(f as SubzoneFeature, l)}
        />
        <GeoJSON
          data={clusters}
          style={{ color: '#14181d', weight: 2, dashArray: '4 3', fillColor: '#14181d', fillOpacity: 0.12 }}
          onEachFeature={(f, l) => l.bindTooltip(`<strong>Active cluster</strong><br/>${f.properties.locality}<br/>${f.properties.cases} cases`, { sticky: true })}
        />
        <FlyToSelected layerRef={layerRef} selectedId={selectedId} flyKey={flyKey} />
      </MapContainer>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Map legend">
        <li><span aria-hidden style={{ color: BAND_COLOR.High }}>▲</span> High</li>
        <li><span aria-hidden style={{ color: BAND_COLOR.Elevated }}>◆</span> Elevated</li>
        <li><span aria-hidden style={{ color: BAND_COLOR.Low }}>●</span> Low</li>
        <li><span aria-hidden className="text-ink-3">○</span> Not ranked (under 100 residents)</li>
        <li><span aria-hidden className="font-bold text-ink">┅</span> Active dengue cluster</li>
      </ul>
    </div>
  )
}
