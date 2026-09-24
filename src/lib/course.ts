import kofunData from '../data/kofun.json'
import { noteFor } from '../data/notes.ts'
import type { CourseStop, Kofun, LatLng } from '../types.ts'
import { bearing, haversineKm } from './geo.ts'

const KOFUN = kofunData as Kofun[]
const ROAD_FACTOR = 1.35

function nearest(start: LatLng, radiusKm: number, limit: number): Kofun[] {
  return KOFUN
    .map((kofun) => ({ kofun, distance: haversineKm(start, kofun) }))
    .filter((item) => item.distance <= radiusKm && item.distance > 0.05)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.kofun)
}

function subsets(items: Kofun[]): Kofun[][] {
  const out: Kofun[][] = []
  const count = items.length
  const masks = 1 << count
  for (let mask = 1; mask < masks; mask += 1) {
    const chosen: Kofun[] = []
    for (let index = 0; index < count; index += 1) {
      if (mask & (1 << index)) chosen.push(items[index])
    }
    if (chosen.length <= 4) out.push(chosen)
  }
  return out
}

function loopKm(start: LatLng, stops: Kofun[]): number {
  let total = 0
  let cursor: LatLng = start
  for (const stop of stops) {
    total += haversineKm(cursor, stop)
    cursor = stop
  }
  total += haversineKm(cursor, start)
  return total * ROAD_FACTOR
}

export function rankStopSets(start: LatLng, targetKm: number): Kofun[][] {
  const radius = Math.min(30, Math.max(2, targetKm * 0.7))
  let pool = nearest(start, radius, 8)
  if (pool.length === 0) pool = nearest(start, Math.min(40, Math.max(radius, targetKm)), 8)
  if (pool.length === 0) return []

  return subsets(pool)
    .map((stops) => [...stops].sort((a, b) => bearing(start, a) - bearing(start, b)))
    .sort((a, b) => Math.abs(loopKm(start, a) - targetKm) - Math.abs(loopKm(start, b) - targetKm))
    .slice(0, 3)
}

export function toStops(kofun: Kofun[]): CourseStop[] {
  return kofun.map((item) => ({
    id: item.id,
    name: item.name,
    address: item.address,
    lat: item.lat,
    lng: item.lng,
    note: noteFor(item.name),
  }))
}

export function nearbyKofun(start: LatLng, radiusKm = 8, limit = 30): Kofun[] {
  return nearest(start, radiusKm, limit)
}
