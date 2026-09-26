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
