/** The browser's slider logic must reproduce Python's published ranking exactly at the default weights. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { normalise, rescore, sameWeights } from '../../web/src/lib/scoring.ts'

const scores = JSON.parse(readFileSync('web/public/data/scores.geojson', 'utf8'))
const meta = JSON.parse(readFileSync('web/public/data/meta.json', 'utf8'))
const props = scores.features.map((f: { properties: unknown }) => f.properties)

test('rescore at default weights matches the published bands and ranks', () => {
  const out = rescore(props, meta.scoring.weights, meta.outlook, meta.scoring.bands, meta.scoring.ranking)
  const eligible = props.filter((p: { eligible: boolean }) => p.eligible)
  assert.equal(out.size, eligible.length)
  for (const p of eligible) {
    const s = out.get(p.subzone_id)!
    assert.equal(s.band, p.band, `band of ${p.subzone}`)
    assert.equal(s.rank, p.rank, `rank of ${p.subzone}`)
    assert.ok(Math.abs(s.risk - p.risk) < 0.0002, `risk of ${p.subzone}`)
  }
})

test('overrides stay first and High when the sliders change, and no Low outranks them', () => {
  const out = rescore(props, { spread: 0, rain: 0.75, temp: 0.25 }, meta.outlook, meta.scoring.bands, meta.scoring.ranking)
  const ranked = [...out.values()].sort((a, b) => a.rank - b.rank)
  const n = ranked.filter((r) => r.props.cluster_override).length
  assert.ok(n > 0)
  ranked.slice(0, n).forEach((r) => { assert.equal(r.props.cluster_override, true); assert.equal(r.band, 'High') })
  const order = { High: 0, Elevated: 1, Low: 2 }
  for (let i = 1; i < ranked.length; i++) assert.ok(order[ranked[i - 1].band] <= order[ranked[i].band], 'band-first order')
})

test('weights are normalised', () => {
  assert.ok(sameWeights({ spread: 0.6, rain: 0.3, temp: 0.1 }, { spread: 6, rain: 3, temp: 1 }))
  assert.deepEqual(normalise({ spread: 0, rain: 0, temp: 0 }), { spread: 1 / 3, rain: 1 / 3, temp: 1 / 3 })
})
