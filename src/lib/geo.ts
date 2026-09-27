import type { LatLng } from '../types.ts'

const EARTH_KM = 6371

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return Math.atan2(y, x)
}

export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`
}

function metersFrom(origin: LatLng, point: LatLng): { north: number; east: number } {
  return {
    north: (point.lat - origin.lat) * 111320,
    east: (point.lng - origin.lng) * 111320 * Math.cos((origin.lat * Math.PI) / 180),
  }
}

export function distanceToLineKm(point: LatLng, line: [number, number][]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = { lat: line[index][0], lng: line[index][1] }
    const end = { lat: line[index + 1][0], lng: line[index + 1][1] }
    const offset = metersFrom(start, point)
    const side = metersFrom(start, end)
    const length = side.north ** 2 + side.east ** 2
    const raw = length === 0 ? 0 : (offset.north * side.north + offset.east * side.east) / length
    const along = Math.max(0, Math.min(1, raw))
    best = Math.min(best, Math.hypot(offset.north - side.north * along, offset.east - side.east * along))
  }
  if (line.length === 1) best = haversineKm(point, { lat: line[0][0], lng: line[0][1] }) * 1000
  return best / 1000
}

export function measureStep(
  previous: LatLng,
  previousAt: number,
  next: LatLng,
  nextAt: number,
  accuracyM: number,
): { accept: boolean; addKm: number } {
  const seconds = (nextAt - previousAt) / 1000
  if (!Number.isFinite(seconds) || seconds < 1) return { accept: false, addKm: 0 }
  // 街中のスマホは、正しい位置でも誤差が35mを超えることが多い。そこで捨てると距離が増えない。
  if (Number.isFinite(accuracyM) && accuracyM > 100) return { accept: false, addKm: 0 }
  const step = haversineKm(previous, next)
  const speed = (step * 1000) / seconds
  // 1秒で数十m跳ぶ点は、位置の飛び。基準は動かさず、次の点で実際の移動を足す。
  if (speed > 8) {
    if (seconds < 5) return { accept: false, addKm: 0 }
    return { accept: true, addKm: Math.min(step, (7 * seconds) / 1000) }
  }
  const accuracy = Number.isFinite(accuracyM) ? accuracyM : 15
  const minMeters = Math.min(20, Math.max(4, accuracy * 0.3))
  if (step * 1000 < minMeters || speed < 0.35) return { accept: false, addKm: 0 }
  return { accept: true, addKm: step }
}

export function ringAreaKm2(line: [number, number][]): number {
  if (line.length < 4) return 0
  let sum = 0
  for (let index = 0; index < line.length; index += 1) {
    const [lat1, lng1] = line[index]
    const [lat2, lng2] = line[(index + 1) % line.length]
    sum += lng1 * lat2 - lng2 * lat1
  }
  return (Math.abs(sum) * 111 * 91) / 2
}

export function offsetPoint(origin: LatLng, bearingDeg: number, distanceKm: number): LatLng {
  const angular = distanceKm / EARTH_KM
  const bearing = (bearingDeg * Math.PI) / 180
  const lat1 = (origin.lat * Math.PI) / 180
  const lng1 = (origin.lng * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    )
  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (((lng2 * 180) / Math.PI + 540) % 360) - 180,
  }
}

export function ringContains(line: [number, number][], point: LatLng): boolean {
  let inside = false
  for (let index = 0, previous = line.length - 1; index < line.length; previous = index, index += 1) {
    const [lat, lng] = line[index]
    const [prevLat, prevLng] = line[previous]
    if ((lng > point.lng) === (prevLng > point.lng)) continue
    const at = ((prevLat - lat) * (point.lng - lng)) / (prevLng - lng) + lat
    if (point.lat < at) inside = !inside
  }
  return inside
}

export function sidePoint(start: LatLng, stop: LatLng, offsetKm: number, sign: number): LatLng {
  const north = (stop.lat - start.lat) * 111
  const east = (stop.lng - start.lng) * 91
  const length = Math.hypot(north, east) || 1
  const midLat = (start.lat + stop.lat) / 2
  const midLng = (start.lng + stop.lng) / 2
  return {
    lat: midLat + ((east / length) * offsetKm * sign) / 111,
    lng: midLng + ((-north / length) * offsetKm * sign) / 91,
  }
}
