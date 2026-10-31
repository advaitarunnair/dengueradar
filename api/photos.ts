/**
 * POST /api/photos { premises_id, image: data URL, lat?, lon?, taken_at? } -> VL classification, stored
 * GET  /api/photos?premises=ID -> photo metadata;  GET /api/photos?id=ID&s=SESSION -> the image itself (an img tag can't send the session header)
 */
import { sql } from './_lib/db.ts'
import { sessionId } from './_lib/guard.ts'
import { BadRequest, handler, readJson } from './_lib/http.ts'
import { classifyAndStore, photosFor } from './_lib/photos.ts'

export const GET = handler(async (req) => {
  const q = new URL(req.url).searchParams
  if (q.get('id')) {
    const rows = (await sql()`select mime, data from photos where id = ${Number(q.get('id'))} and session_id = ${q.get('s') ?? sessionId(req)}`) as { mime: string; data: Uint8Array | string }[]
    if (!rows.length) return new Response('Not found', { status: 404 })
    const d = rows[0].data
    const bytes = typeof d === 'string' ? Buffer.from(d.replace(/^\\x/, ''), 'hex') : Buffer.from(d)
    return new Response(bytes, { headers: { 'content-type': rows[0].mime, 'cache-control': 'private, max-age=86400' } })
  }
  return Response.json({ photos: await photosFor(Number(q.get('premises')), sessionId(req)) })
})

export const POST = handler(async (req) => {
  const b = await readJson<{ premises_id?: number; image?: string; lat?: number; lon?: number; taken_at?: string }>(req)
  if (!b.premises_id || !b.image) throw new BadRequest('premises_id and image are required')
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  try {
    return Response.json(await classifyAndStore(sessionId(req), { premises_id: Number(b.premises_id), image: b.image, lat: num(b.lat), lon: num(b.lon), taken_at: b.taken_at ?? null }))
  } catch (e) {
    if ((e as Error).message.startsWith('Expected') || (e as Error).message.startsWith('Photo is too large')) throw new BadRequest((e as Error).message)
    throw e
  }
})
