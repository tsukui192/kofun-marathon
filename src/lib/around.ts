import type { LatLng } from '../types.ts'
import { haversineKm, offsetPoint, ringAreaKm2, ringContains } from './geo.ts'

type Path = {
  distanceMeters: number
  line: [number, number][]
}

const RADII_KM = [0.18, 0.3, 0.45, 0.65, 0.9, 1.2]
const BEARINGS = [20, 80, 140, 200, 260, 320]

function centered(line: [number, number][], center: LatLng, distanceKm: number): boolean {
  const area = ringAreaKm2(line)
  if (area < 0.03 || !ringContains(line, center)) return false
  const ideal = 2 * Math.sqrt(Math.PI * area)
  if (distanceKm / ideal > 2.2) return false
  let lat = 0
  let lng = 0
  for (const [pointLat, pointLng] of line) {
    lat += pointLat
    lng += pointLng
  }
  const middle = { lat: lat / line.length, lng: lng / line.length }
  const radius = Math.sqrt(area / Math.PI)
  return haversineKm(center, middle) <= Math.max(0.25, radius * 0.6)
}

export async function routeAround(
  center: LatLng,
  fetchPath: (coordinates: [number, number][]) => Promise<Path>,
): Promise<Path> {
  const attempts: Path[] = []
  let failed = false
  for (const radiusKm of RADII_KM) {
    const ring = BEARINGS.map((bearing) => offsetPoint(center, bearing, radiusKm))
    const closed = [...ring, ring[0]].map((point) => [point.lng, point.lat] as [number, number])
    try {
      const route = await fetchPath(closed)
      if (centered(route.line, center, route.distanceMeters / 1000)) return route
      attempts.push(route)
    } catch {
      failed = true
    }
  }
  const fallback = attempts
    .filter((route) => ringContains(route.line, center) && ringAreaKm2(route.line) >= 0.03)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0]
  if (fallback && fallback.distanceMeters / 1000 < 15) return fallback
  if (attempts.length === 0 && failed) {
    throw new Error('道順を作れませんでした。しばらくしてからもう一度試してください。')
  }
  throw new Error('この古墳のまわりを回る道が見つかりませんでした。')
}
