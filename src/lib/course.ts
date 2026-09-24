import kofunData from '../data/kofun.json'
import { noteFor } from '../data/notes.ts'
import type { CourseStop, Kofun, LatLng, PlaceHit } from '../types.ts'
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

export function loopKm(start: LatLng, stops: LatLng[]): number {
  let total = 0
  let cursor: LatLng = start
  for (const stop of stops) {
    total += haversineKm(cursor, stop)
    cursor = stop
  }
  total += haversineKm(cursor, start)
  return total * ROAD_FACTOR
}

/** 起点を出て選んだ古墳をすべて通り、起点へ戻る最短順。 */
export function orderLoop<T extends LatLng>(start: LatLng, stops: T[]): T[] {
  const count = stops.length
  if (count <= 1) return stops

  const size = 1 << count
  const cost = Array.from({ length: size }, () => Array<number>(count).fill(Number.POSITIVE_INFINITY))
  const previous = Array.from({ length: size }, () => Array<number>(count).fill(-1))

  for (let index = 0; index < count; index += 1) {
    cost[1 << index][index] = haversineKm(start, stops[index])
  }

  for (let mask = 1; mask < size; mask += 1) {
    for (let last = 0; last < count; last += 1) {
      if ((mask & (1 << last)) === 0) continue
      const soFar = cost[mask][last]
      if (!Number.isFinite(soFar)) continue
      for (let next = 0; next < count; next += 1) {
        if (mask & (1 << next)) continue
        const nextMask = mask | (1 << next)
        const nextCost = soFar + haversineKm(stops[last], stops[next])
        if (nextCost < cost[nextMask][next]) {
          cost[nextMask][next] = nextCost
          previous[nextMask][next] = last
        }
      }
    }
  }

  const full = size - 1
  let end = 0
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < count; index += 1) {
    const total = cost[full][index] + haversineKm(stops[index], start)
    if (total < best) {
      best = total
      end = index
    }
  }

  const order: number[] = []
  let mask = full
  let current = end
  while (current !== -1) {
    order.push(current)
    const prior = previous[mask][current]
    mask ^= 1 << current
    current = prior
  }
  order.reverse()
  return order.map((index) => stops[index])
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

export function rankWideStopSets(start: LatLng, targetKm: number): Kofun[][] {
  const radius = Math.min(30, Math.max(8, targetKm))
  const pool = nearest(start, radius, 8)
  if (pool.length === 0) return []
  return subsets(pool)
    .map((stops) => [...stops].sort((a, b) => bearing(start, a) - bearing(start, b)))
    .filter((stops) => loopKm(start, stops) <= targetKm + 1.5)
    .sort((a, b) => loopKm(start, b) - loopKm(start, a))
    .slice(0, 3)
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

export function kofunFromLabel(label: string): { name: string; address: string } | null {
  if (!label.includes('古墳')) return null
  const parts = label.split(/\s+/).filter(Boolean)
  const index = parts.findIndex((part) => part.includes('古墳'))
  if (index < 0) return null
  return { name: parts.slice(index).join(''), address: parts.slice(0, index).join(' ') }
}

export function kofunPlaces(query: string): PlaceHit[] {
  const trimmed = query.trim()
  if (trimmed.length < 2 || trimmed === '古墳') return []
  return KOFUN.filter((item) => item.name === trimmed || (trimmed.includes('古墳') && item.name.includes(trimmed))).map(
    (item) => ({
      label: `${item.address} ${item.name}`,
      lat: item.lat,
      lng: item.lng,
    }),
  )
}
