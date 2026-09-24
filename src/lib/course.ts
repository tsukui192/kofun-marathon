import kofunData from '../data/kofun.json'
import { noteFor } from '../data/notes.ts'
import type { CourseStop, Kofun, LatLng } from '../types.ts'
import { haversineKm } from './geo.ts'

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
