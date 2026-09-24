import type { PlaceHit } from '../types.ts'

export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`)
  const body = (await response.json()) as PlaceHit[] | { error?: string }
  if (!response.ok || !Array.isArray(body)) {
    const message = !Array.isArray(body) && body.error ? body.error : '地名を探せませんでした。'
    throw new Error(message)
  }
  return body
}

export type WikiSummary = {
  title: string
  url: string
  period: string
  size: string
  notes: string
}

export async function fetchWiki(name: string, address: string): Promise<WikiSummary> {
  const params = new URLSearchParams({ name, address })
  const response = await fetch(`/api/wiki?${params.toString()}`)
  const body = (await response.json()) as WikiSummary & { error?: string }
  if (!response.ok) {
    throw new Error(body.error ?? 'ウィキペディアにまとめが見つかりませんでした。')
  }
  return body
}

export async function fetchRoute(coordinates: [number, number][]): Promise<{
  distanceMeters: number
  line: [number, number][]
}> {
  const response = await fetch('/api/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  })
  const body = (await response.json()) as {
    error?: string
    distanceMeters: number
    line: [number, number][]
  }
  if (!response.ok) {
    throw new Error(body.error ?? '道順を作れませんでした。しばらくしてからもう一度試してください。')
  }
  return body
}
