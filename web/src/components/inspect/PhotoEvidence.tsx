import { useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../lib/api'

interface Photo { id: number; label: string; is_clear: boolean; model_note: string; taken_at: string; lat: number | null; lon: number | null; inspection_id?: number | null }

const LABEL: Record<string, string> = { container: 'Container', puddle: 'Puddle / ponding', drain: 'Drain / gutter', other: 'Other' }

/** Resize in the browser (max 1280 px JPEG) so uploads stay small on mobile data. */
async function resize(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.82)
}

function position(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), () => resolve(null), { timeout: 4000, maximumAge: 60000 })
  })
}

/** Photo evidence: Nemotron VL labels each photo and asks for a retake when it is unclear. */
export default function PhotoEvidence({ premisesId, fallback, onNewIds }: { premisesId: number; fallback: { lat: number; lon: number }; onNewIds: (ids: number[]) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fresh = useRef<number[]>([])
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { apiGet<{ photos: Photo[] }>(`photos?premises=${premisesId}`).then((r) => setPhotos(r.photos)).catch(() => {}) }, [premisesId])

  const upload = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const [image, pos] = await Promise.all([resize(file), position()])
      const where = pos ?? fallback
      const p = await apiPost<Photo>('photos', { premises_id: premisesId, image, lat: where.lat, lon: where.lon, taken_at: new Date().toISOString() })
      setPhotos((ps) => [p, ...ps])
      fresh.current = [...fresh.current, p.id]
      onNewIds(fresh.current)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className={`cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft ${busy ? 'opacity-50' : ''}`}>
          <span aria-hidden>📷</span> {busy ? 'Checking photo…' : 'Add photo'}
          <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
        </label>
        <span className="text-xs text-ink-3">Nemotron VL labels the habitat and flags unclear photos. Location uses your GPS if allowed, otherwise the premises.</span>
      </div>
      {error && <p role="alert" className="text-sm text-ink">⚠ {error}</p>}
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-lg border border-line bg-white">
              <img src={`/api/photos?id=${p.id}`} alt={`${LABEL[p.label] ?? p.label}: ${p.model_note}`} className="h-28 w-full object-cover" loading="lazy" />
              <div className="space-y-0.5 p-2 text-xs">
                <p className="font-medium text-ink">{LABEL[p.label] ?? p.label}</p>
                {p.is_clear ? <p className="text-ink-2">{p.model_note}</p> : <p className="text-ink"><span aria-hidden>⚠</span> Retake: {p.model_note}</p>}
                <p className="text-ink-3">{new Date(p.taken_at).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}{p.inspection_id ? ` · report #${p.inspection_id}` : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
