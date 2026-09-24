import type { PlaceHit } from '../types.ts'

export type WikiSummary = {
  title: string
  url: string
  period: string
  size: string
  notes: string
}

function cityFromAddress(address: string) {
  const tokens = address.split(/\s+/).filter(Boolean)
  return tokens.find((token) => /[市区町村]$/.test(token) && !/[都道府県]$/.test(token)) ?? ''
}

function stripWiki(value: string) {
  return value
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[\s\S]*?<\/ref>/g, '')
    .replace(/<br\s*\/?>/gi, '、')
    .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''|''/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, '')
    .replace(/、+/g, '、')
    .replace(/^、|、$/g, '')
    .trim()
}

function wikiField(text: string, key: string) {
  const matched = text.match(new RegExp(`(?:^|\\n)\\|\\s*${key}[ \\t]*=[ \\t]*([^\\n]*)`))
  return matched ? stripWiki(matched[1]) : ''
}

function wikiApi(params: Record<string, string>) {
  const url = new URL('https://ja.wikipedia.org/w/api.php')
  url.searchParams.set('origin', '*')
  url.searchParams.set('format', 'json')
  url.searchParams.set('utf8', '1')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

async function wikiSearch(query: string) {
  const response = await fetch(
    wikiApi({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '8',
    }),
  )
  if (!response.ok) throw new Error('ウィキペディアを参照できませんでした。')
  const data = (await response.json()) as {
    query?: { search?: { title: string }[] }
  }
  return data.query?.search ?? []
}

async function wikiText(title: string) {
  const response = await fetch(
    wikiApi({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: title,
      redirects: '1',
    }),
  )
  if (!response.ok) return null
  const data = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; missing?: string; revisions?: { slots?: { main?: { '*'?: string } } }[] }
      >
    }
  }
  const page = Object.values(data.query?.pages ?? {})[0]
  if (!page || page.missing !== undefined) return null
  const text = page.revisions?.[0]?.slots?.main?.['*'] ?? ''
  if (text.includes('曖昧さ回避') || text.includes('{{Aimai}}')) return null
  return { title: page.title ?? title, text }
}

const FAME_WORDS: [string, number][] = [
  ['国宝', 5],
  ['最大', 4],
  ['唯一', 4],
  ['最古', 4],
  ['壁画', 4],
  ['線刻画', 4],
  ['金錯', 4],
  ['世界', 3],
  ['特別史跡', 3],
  ['装飾', 3],
  ['珍', 3],
  ['有名', 2],
  ['知られ', 2],
  ['出土', 2],
]

function articleSentences(text: string) {
  const leadStart = text.search(/\n'''/)
  const lead = leadStart >= 0 ? text.slice(leadStart).split(/\n==/)[0] : ''
  const overview = text.match(/==+\s*概要\s*==+\n([\s\S]*?)(?=\n==|$)/)?.[1] ?? ''
  return stripWiki(`${lead}\n${overview}`)
    .split('。')
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18)
}

function fameScore(sentence: string) {
  return FAME_WORDS.reduce((score, [word, weight]) => score + (sentence.includes(word) ? weight : 0), 0)
}

function famousNotes(text: string) {
  const candidates = [wikiField(text, '特記事項'), wikiField(text, '出土品'), ...articleSentences(text)]
  const ranked = candidates
    .filter(Boolean)
    .map((sentence) => ({ sentence, score: fameScore(sentence) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
  const picked: string[] = []
  for (const item of ranked) {
    if (picked.some((note) => note.includes(item.sentence) || item.sentence.includes(note))) continue
    picked.push(item.sentence)
    if (picked.length === 2) break
  }
  return picked.join('。')
}

function scoreWikiTitle(title: string, name: string, city: string) {
  if (city && title === `${name} (${city})`) return 5
  if (title === name) return 4
  if (title.startsWith(name) && city && title.includes(city)) return 3
  if (title.startsWith(name)) return 2
  return 0
}

export async function fetchWiki(name: string, address: string): Promise<WikiSummary> {
  const city = cityFromAddress(address)
  let hits: { title: string }[] = []
  try {
    hits = await wikiSearch(city ? `${name} ${city}` : name)
  } catch {
    hits = []
  }
  const titles = [...hits.map((hit) => hit.title)]
  if (!titles.includes(name)) titles.unshift(name)
  if (city && !titles.includes(`${name} (${city})`)) titles.unshift(`${name} (${city})`)
  const ordered = titles.sort((a, b) => scoreWikiTitle(b, name, city) - scoreWikiTitle(a, name, city))
  for (const title of ordered) {
    const page = await wikiText(title)
    if (!page) continue
    const pageName = wikiField(page.text, '名称')
    const place = wikiField(page.text, '所在地')
    const nameMatches = page.title.startsWith(name) || pageName === name || page.text.includes(`'''${name}'''`)
    const placeMatches = !city || place.includes(city) || page.title.includes(city)
    if (!nameMatches || !placeMatches) continue
    const period = wikiField(page.text, '築造年代') || wikiField(page.text, '築造時期')
    const shape = wikiField(page.text, '形状')
    const scale = wikiField(page.text, '規模') || wikiField(page.text, '墳長') || wikiField(page.text, '墳丘長')
    const notes = famousNotes(page.text)
    return {
      title: page.title,
      url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
      period: period || '記事に年代の記載がありません。',
      size: [shape, scale].filter(Boolean).join('、') || '記事にサイズの記載がありません。',
      notes: notes || '記事に、なぜ知られているかの記載がありません。',
    }
  }
  throw new Error('名前と所在地が一致するウィキペディアの記事が見つかりませんでした。')
}

let municipalityNames: Map<string, { prefecture: string; city: string }> | null = null

async function municipalityName(code: string) {
  if (!municipalityNames) {
    const response = await fetch('https://maps.gsi.go.jp/js/muni.js')
    if (!response.ok) return null
    const text = await response.text()
    const names = new Map<string, { prefecture: string; city: string }>()
    for (const match of text.matchAll(/GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g)) {
      const parts = match[2].split(',')
      names.set(match[1], { prefecture: parts[1] ?? '', city: parts[3] ?? '' })
    }
    municipalityNames = names
  }
  return municipalityNames.get(code) ?? null
}

function isStreetAddress(title: string) {
  return /^.{2,3}[都道府県]/.test(title) && !/(駅|交番|署|警察|学校|公園|病院|ホーム|センター|博物館|消防)/.test(title)
}

function formatGsiTitle(title: string) {
  return title.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/番地$/u, '')
}

async function addressAt(lat: number, lng: number) {
  const response = await fetch(
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`,
  )
  if (!response.ok) return ''
  const data = (await response.json()) as { results?: { muniCd?: string; lv01Nm?: string } }
  const municipality = await municipalityName(data.results?.muniCd ?? '')
  if (!municipality) return ''
  return `${municipality.prefecture}${municipality.city}${data.results?.lv01Nm ?? ''}`
}

export async function searchPlaces(query: string): Promise<PlaceHit[]> {
  const search = new URL('https://msearch.gsi.go.jp/address-search/AddressSearch')
  search.searchParams.set('q', query.trim())
  const response = await fetch(search)
  if (!response.ok) throw new Error('地名検索に失敗しました。')
  const places = (await response.json()) as {
    geometry?: { coordinates?: [number, number] }
    properties?: { title?: string }
  }[]
  const candidates = places.flatMap((place) => {
    const [lng, lat] = place.geometry?.coordinates ?? []
    const title = formatGsiTitle(place.properties?.title ?? '')
    if (lat === undefined || lng === undefined || !title || /[「」()（）]/.test(title)) return []
    return [{ title, lat, lng }]
  })
  const chosen =
    candidates.find((place) => place.title === query || place.title.endsWith(query)) ??
    candidates.find((place) => isStreetAddress(place.title)) ??
    candidates[0]
  if (!chosen) return []
  const label = isStreetAddress(chosen.title) ? chosen.title : await addressAt(chosen.lat, chosen.lng)
  return label ? [{ label, lat: chosen.lat, lng: chosen.lng }] : []
}

export async function fetchOptimalLoop(coordinates: [number, number][]): Promise<{
  distanceMeters: number
  line: [number, number][]
  order: number[]
}> {
  const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const response = await fetch(
    `https://router.project-osrm.org/trip/v1/foot/${path}?roundtrip=true&source=first&overview=full&geometries=geojson`,
  )
  if (!response.ok) throw new Error('道順を作れませんでした。しばらくしてからもう一度試してください。')
  const data = (await response.json()) as {
    code?: string
    trips?: { distance: number; geometry: { coordinates: [number, number][] } }[]
    waypoints?: { waypoint_index: number }[]
  }
  const trip = data.trips?.[0]
  const waypoints = data.waypoints ?? []
  if (data.code !== 'Ok' || !trip || waypoints.length !== coordinates.length) {
    throw new Error('道順を作れませんでした。しばらくしてからもう一度試してください。')
  }
  const order = waypoints
    .map((waypoint, index) => ({ index, place: waypoint.waypoint_index }))
    .sort((a, b) => a.place - b.place)
    .map((item) => item.index)
  return {
    distanceMeters: trip.distance,
    line: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    order,
  }
}

export async function fetchRoute(coordinates: [number, number][]): Promise<{
  distanceMeters: number
  line: [number, number][]
}> {
  const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/foot/${path}?overview=full&geometries=geojson`,
  )
  if (!response.ok) throw new Error('道順を作れませんでした。しばらくしてからもう一度試してください。')
  const data = (await response.json()) as {
    code?: string
    routes?: { distance: number; geometry: { coordinates: [number, number][] } }[]
  }
  const route = data.routes?.[0]
  if (data.code !== 'Ok' || !route) {
    throw new Error('道順を作れませんでした。しばらくしてからもう一度試してください。')
  }
  return {
    distanceMeters: route.distance,
    line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
  }
}
