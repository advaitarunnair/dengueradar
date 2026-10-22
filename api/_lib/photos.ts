/** Photo evidence: Nemotron VL classifies the habitat and flags unclear photos for a retake. */
import { sql } from './db.ts'
import { complete, parseJson } from './llm.ts'

export const LABELS = ['container', 'puddle', 'drain', 'other'] as const

export async function classifyAndStore(session: string, input: { premises_id: number; image: string; lat: number | null; lon: number | null; taken_at: string | null }) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(input.image)
  if (!m) throw new Error('Expected a JPEG, PNG or WebP image')
  const bytes = Buffer.from(m[3], 'base64')
  if (bytes.length > 2_500_000) throw new Error('Photo is too large; it should be resized in the browser first')
  const r = await complete({
    model: 'VL', endpoint: 'photo', session, maxTokens: 200, json: true, temperature: 0,
    messages: [{ role: 'user', content: [
      { type: 'text', text: `You check photos taken by NEA dengue inspectors as evidence of possible Aedes breeding habitats.
Classify the main subject: "container" (pail, pot plate, vase, drum, discarded receptacle, bamboo pole holder), "puddle" (ponding, ground depression, floor slab water), "drain" (drain, scupper drain, gully trap, roof gutter) or "other".
is_clear is false if the photo is blurry, too dark, or the subject cannot be identified; then the inspector should retake it.
note: at most 20 words on what is visible, e.g. whether stagnant water is visible. Do not claim larvae unless clearly visible.
Reply with ONLY JSON: {"label": "container" | "puddle" | "drain" | "other", "is_clear": true | false, "note": ""}` },
      { type: 'image_url', image_url: { url: input.image } },
    ] }],
  })
  const out = parseJson<{ label: string; is_clear: boolean; note: string }>(r.text)
  const label = (LABELS as readonly string[]).includes(out.label) ? out.label : 'other'
  const [row] = (await sql()`insert into photos (premises_id, taken_at, lat, lon, mime, data, label, is_clear, model_note)
    values (${input.premises_id}, ${input.taken_at ?? new Date().toISOString()}, ${input.lat}, ${input.lon}, ${m[1]}, ${bytes},
            ${label}, ${Boolean(out.is_clear)}, ${String(out.note ?? '').slice(0, 200)})
    returning id, label, is_clear, model_note, taken_at::text, lat, lon`) as PhotoMeta[]
  return row
}

export interface PhotoMeta { id: number; label: string; is_clear: boolean; model_note: string; taken_at: string; lat: number | null; lon: number | null; inspection_id?: number | null }

export async function photosFor(premisesId: number): Promise<PhotoMeta[]> {
  return (await sql()`select id, label, is_clear, model_note, taken_at::text, lat, lon, inspection_id from photos
    where premises_id = ${premisesId} order by id desc limit 24`) as PhotoMeta[]
}
