/**
 * Deterministic geometry, kept out of the LLM: nearest-neighbour visiting order within each team's areas,
 * split into days by premises-per-day capacity.
 */
import { distanceKm } from './data.ts'

export interface Stop { premises_id: number; code: string; name: string; premises_type: string; subzone_id: string; lat: number; lon: number }

export function nearestNeighbourOrder(stops: Stop[], start?: { lat: number; lon: number }): Stop[] {
  if (stops.length <= 1) return [...stops]
  const left = [...stops]
  let current = start ?? left[0]
  const order: Stop[] = []
  while (left.length) {
    let best = 0
    for (let i = 1; i < left.length; i++) if (distanceKm(current, left[i]) < distanceKm(current, left[best])) best = i
    current = left.splice(best, 1)[0]
    order.push(current as Stop)
  }
  return order
}

export function splitIntoDays(order: Stop[], perDay: number, days: number) {
  const out: { day: number; stops: Stop[]; km: number }[] = []
  for (let d = 0; d < days && d * perDay < order.length; d++) {
    const stops = order.slice(d * perDay, (d + 1) * perDay)
    let km = 0
    for (let i = 1; i < stops.length; i++) km += distanceKm(stops[i - 1], stops[i])
    out.push({ day: d + 1, stops, km: Math.round(km * 10) / 10 })
  }
  return out
}
