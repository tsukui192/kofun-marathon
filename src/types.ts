export type Kofun = {
  id: string
  name: string
  reading: string
  address: string
  lat: number
  lng: number
}

export type LatLng = {
  lat: number
  lng: number
}

export type PlaceHit = LatLng & {
  label: string
}

export type CourseStop = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  note: string
}

export type CoursePlan = {
  id: string
  title: string
  createdAt: string
  targetKm: number
  distanceKm: number
  laps?: number
  start: PlaceHit
  stops: CourseStop[]
  line: [number, number][]
}

export type Visit = {
  id: string
  name: string
  address: string
  note: string
  visitedAt: string
}
