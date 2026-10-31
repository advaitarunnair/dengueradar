/** Number rendering and capacity packing: pure logic, no database or model calls. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Area } from '../../api/_lib/data.ts'
import { allocateTeams, hasFigure, MAX_DETOUR_KM, renderReason } from '../../api/_lib/planrender.ts'
import type { Stop } from '../../api/_lib/routing.ts'

const area = (id: string, extra: Partial<Area> = {}): Area => ({
  subzone_id: id, subzone: id.toUpperCase(), planning_area: 'P', region: 'WEST REGION', residents: 1000, age65plus: 100, under15: 100, vulnerable: 18980, eligible: true,
  spread: 0.5, rain: 0.5, temp: 0.5, rain_mm: 213.5, temp_c: 29.2, rain_mm_station: '', temp_c_station: '', clusters_within_1km: 1, cluster_cases_within_1km: 2,
  nearest_cluster_km: 0.77, risk: 0.5, priority: 1, band: 'High', risk_rank: 1, rank: 1, rank_change: 0, is_new_in_top20: false, reason: '', lat: 1.35, lon: 103.7, ...extra,
})
const stops = (id: string, n: number): Stop[] => Array.from({ length: n }, (_, i) => ({ premises_id: i, code: `${id}${i}`, name: `${id}${i}`, premises_type: 'hdb_block', subzone_id: id, lat: 1.35, lon: 103.7 }))

test('reasons are rendered from data keys, with numbers from that area only', () => {
  const r = renderReason(area('a'), ['cluster_within_1km', 'seniors_children'], 'Busy precinct near the cluster', 'Check drains')
  assert.equal(r.reason, '1 active cluster within 1 km (2 cases); 18,980 seniors and children. Busy precinct near the cluster.')
  assert.equal(r.focus, 'Check drains')
  assert.deepEqual(r.corrections, [])
})

test('a note or focus containing a number is removed and reported, in natural prose', () => {
  const r = renderReason(area('a'), ['seniors_children'], 'Has 99 cases nearby', 'Check 3 drains')
  assert.equal(r.reason, '18,980 seniors and children.')
  assert.equal(r.focus, '')
  assert.deepEqual(r.corrections.map((c) => c.field), ['note', 'focus'])
  assert.ok(!r.reason.includes('facts from data'))
})

test('unknown or missing keys fall back to sensible facts; an override always leads', () => {
  assert.ok(renderReason(area('a'), ['made_up'], '', '').reason.includes('mm of rain'))
  const r = renderReason(area('a', { cluster_override: true, max_cluster_cases_near: 100 }), ['seniors_children'], '', '')
  assert.ok(r.reason.startsWith('100-case cluster within 1 km'))
  const single = renderReason(area('a', { cluster_override: true, max_cluster_cases_near: 100, clusters_within_1km: 1 }), ['cluster_within_1km', 'seniors_children'], '', '')
  assert.equal(single.reason, '100-case cluster within 1 km; 18,980 seniors and children.', 'no repeated cluster line')
})

test('areas fit in priority order, and an area that does not fit is partly covered rather than cut', () => {
  const chosen = [
    { area: area('a'), stops: stops('a', 7) },
    { area: area('b'), stops: stops('b', 5) },
  ]
  const { placements, dropped, free } = allocateTeams(chosen, ['T1'], 10, { T1: ['WEST'] })
  assert.deepEqual(placements.map((p) => [p.subzone_id, p.stops.length, p.premises_total]), [['a', 7, 7], ['b', 3, 5]])
  assert.equal(dropped.length, 0)
  assert.equal(free.T1, 0)
})

test('with no slots left the area is cut, with the exact reason', () => {
  const { placements, dropped } = allocateTeams([{ area: area('a'), stops: stops('a', 10) }, { area: area('b'), stops: stops('b', 5) }], ['T1'], 10, { T1: ['WEST'] })
  assert.equal(placements.length, 1)
  assert.match(dropped[0].why, /T1 0 of 10 slots left/)
})

test('capacity is never exceeded and teams stay local', () => {
  const west = area('w', { lat: 1.35, lon: 103.7 })
  const east = area('e', { lat: 1.35, lon: 103.95, region: 'EAST REGION' }) // about 28 km away
  const { placements, dropped } = allocateTeams([{ area: west, stops: stops('w', 6) }, { area: east, stops: stops('e', 4) }], ['T1'], 10, { T1: ['WEST'] })
  assert.deepEqual(placements.map((p) => p.subzone_id), ['w'])
  assert.match(dropped[0].why, new RegExp(`within ${MAX_DETOUR_KM} km`))
  const many = Array.from({ length: 8 }, (_, i) => ({ area: area(`a${i}`), stops: stops(`a${i}`, 6) }))
  const out = allocateTeams(many, ['T1', 'T2'], 15, { T1: ['WEST'], T2: ['WEST'] })
  for (const t of ['T1', 'T2']) assert.ok(out.placements.filter((p) => p.team === t).reduce((s, p) => s + p.stops.length, 0) <= 15)
})

test('the model’s team is kept when it fits and matches the team’s home', () => {
  const { placements } = allocateTeams([{ area: area('a'), team: 'T2', stops: stops('a', 3) }], ['T1', 'T2'], 10, { T1: ['WEST'], T2: ['WEST'] })
  assert.equal(placements[0].team, 'T2')
})

test('digits in a place name are not figures', () => {
  const a = area('a', { subzone: 'LORONG 8 TOA PAYOH', planning_area: 'TOA PAYOH' })
  assert.equal(hasFigure('Inspect Lorong 8 blocks', a), false)
  assert.equal(hasFigure('Check Lorong 8 Toa Payoh drains', a), false)
  assert.equal(hasFigure('Has 20 cases nearby', a), true)
  assert.equal(renderReason(a, ['seniors_children'], 'Busy lanes in Lorong 8', 'Check Lorong 8 drains').corrections.length, 0)
})
