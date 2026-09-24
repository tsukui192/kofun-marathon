import type { PlaceHit } from '../types.ts'
import { haversineKm } from './geo.ts'

export type WikiSummary = {
  title: string
  url: string
  period: string
  size: string
  notes: string
  sources: string[]
}

function cityFromAddress(address: string) {
  const tokens = address.split(/\s+/).filter(Boolean)
  return tokens.find((token) => /[市区町村]$/.test(token) && !/[都道府県]$/.test(token)) ?? ''
}

function prefectureFromAddress(address: string) {
  return address.split(/\s+/).find((token) => /[都道府県]$/.test(token)) ?? ''
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

type WikiHit = { title: string; snippet: string }
type WikiPage = { title: string; text: string }

async function wikiSearch(query: string) {
  const response = await fetch(
    wikiApi({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '5',
      srprop: 'snippet',
    }),
  )
  if (!response.ok) throw new Error('ウィキペディアを参照できませんでした。')
  const data = (await response.json()) as {
    query?: { search?: WikiHit[] }
  }
  return data.query?.search ?? []
}

async function wikiTexts(titles: string[]): Promise<WikiPage[]> {
  const unique = [...new Set(titles.filter(Boolean))]
  if (unique.length === 0) return []
  const response = await fetch(
    wikiApi({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: unique.join('|'),
      redirects: '1',
    }),
  )
  if (!response.ok) return []
  const data = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; missing?: string; revisions?: { slots?: { main?: { '*'?: string } } }[] }
      >
    }
  }
  return Object.values(data.query?.pages ?? {}).flatMap((page) => {
    if (!page || page.missing !== undefined) return []
    const text = page.revisions?.[0]?.slots?.main?.['*'] ?? ''
    if (!text || text.includes('曖昧さ回避') || text.includes('{{Aimai}}')) return []
    return [{ title: page.title ?? '', text }]
  })
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

function prosePlain(text: string) {
  const leadStart = text.search(/\n'''/)
  const lead = leadStart >= 0 ? text.slice(leadStart).split(/\n==/)[0] : ''
  const overview = text.match(/==+\s*概要\s*==+\n([\s\S]*?)(?=\n==|$)/)?.[1] ?? ''
  return stripWiki(`${lead}\n${overview}`)
}

function prosePeriod(text: string) {
  const matched = prosePlain(text).match(
    /[0-9]+世紀(?:末|初頭|前半|後半|中頃)?(?:から[0-9]+世紀(?:末|初頭|前半|後半|中頃)?)?/,
  )
  return matched?.[0] ?? ''
}

function proseSize(text: string) {
  const plain = prosePlain(text)
  const counts = plain.match(/(?:前方後円墳|円墳|方墳)[0-9]+基(?:、(?:前方後円墳|円墳|方墳)[0-9]+基)*/)
  if (counts) return counts[0]
  const length = plain.match(/全長[0-9.]+メートル|墳丘長[0-9.]+メートル|墳長[0-9.]+メートル/)
  return length?.[0] ?? ''
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
  if (picked.length > 0) return picked.join('。')
  return articleSentences(text).find((sentence) => /消失|埋没|史跡|出土|指定|壁画|国宝/.test(sentence)) ?? ''
}

function periodIn(sentence: string) {
  const matched = sentence.match(
    /[0-9]+世紀(?:末|初頭|前半|後半|中頃)?頃?(?:から[0-9]+世紀(?:末|初頭|前半|後半|中頃)?頃?)?/,
  )
  return matched?.[0] ?? ''
}

function sizeIn(sentence: string) {
  const shape = sentence.match(/帆立貝(?:形|型)の前方後円墳|帆立貝(?:形|型)|前方後円墳|前方後方墳|上円下方墳|円墳|方墳/)
  const length = sentence.match(/(?:全長|墳丘長|墳長)約?[0-9.]+メートル/)
  return [shape?.[0], length?.[0]].filter(Boolean).join('、')
}

function mentionSentences(text: string, name: string) {
  return stripWiki(text)
    .split('。')
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.includes(name) && !sentence.includes('{{') && sentence.length >= name.length + 4)
}

function noteFromMention(sentence: string, name: string, period: string, size: string) {
  let head = sentence.split(name)[0] ?? ''
  for (const part of [period, size]) {
    if (part) head = head.replace(part, '')
  }
  head = head
    .replace(/である|にあたる|現在の|続いて|築造される|築造された/g, '')
    .replace(/[、\s]+/g, '、')
    .replace(/^、+|、+$/g, '')
    .replace(/[にでへと]+$/g, '')
  if (head.length > 36) head = head.slice(-36).replace(/^[^、]*、/, '')
  return head.length >= 8 ? head : ''
}

function hasWikiFacts(summary: WikiSummary) {
  return summary.period !== '特になし' || summary.size !== '特になし' || summary.notes !== '特になし'
}

function scoreWikiTitle(title: string, name: string, city: string) {
  if (city && title === `${name} (${city})`) return 5
  if (title === name) return 4
  if (title.startsWith(name) && city && title.includes(city)) return 3
  if (title.startsWith(name)) return 2
  return 0
}

function summaryFromPage(page: WikiPage, name: string, city: string): WikiSummary | null {
  const pageName = wikiField(page.text, '名称')
  const place = wikiField(page.text, '所在地')
  const nameMatches = page.title.startsWith(name) || pageName === name || page.text.includes(`'''${name}'''`)
  const placeMatches = !city || place.includes(city) || page.title.includes(city) || page.text.includes(city)
  if (!nameMatches || !placeMatches) return null
  const period = wikiField(page.text, '築造年代') || wikiField(page.text, '築造時期') || prosePeriod(page.text)
  const shape = wikiField(page.text, '形状')
  const scale =
    wikiField(page.text, '規模') || wikiField(page.text, '墳長') || wikiField(page.text, '墳丘長') || proseSize(page.text)
  const notes = famousNotes(page.text)
  return {
    title: page.title,
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    period: period || '特になし',
    size: [shape, scale].filter(Boolean).join('、') || '特になし',
    notes: notes || '特になし',
    sources: period || shape || scale || notes ? ['日本語版ウィキペディア'] : [],
  }
}

function summaryFromMention(name: string, articleTitle: string, sentence: string): WikiSummary | null {
  const period = periodIn(sentence)
  const size = sizeIn(sentence)
  if (!period && !size) return null
  const notes = noteFromMention(sentence, name, period, size)
  return {
    title: name,
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(articleTitle)}`,
    period: period || '特になし',
    size: size || '特になし',
    notes: notes || '特になし',
    sources: ['日本語版ウィキペディア'],
  }
}

function plainSnippet(snippet: string) {
  return stripWiki(snippet.replace(/<[^>]+>/g, ''))
}

export async function fetchWiki(name: string, address: string): Promise<WikiSummary> {
  const city = cityFromAddress(address)
  const prefecture = prefectureFromAddress(address)
  const directTitles = [city ? `${name} (${city})` : '', name].filter(Boolean)
  const [pages, hits] = await Promise.all([
    wikiTexts(directTitles),
    wikiSearch(name).catch(() => [] as WikiHit[]),
  ])
  const ordered = [...pages].sort((a, b) => scoreWikiTitle(b.title, name, city) - scoreWikiTitle(a.title, name, city))
  for (const page of ordered) {
    const summary = summaryFromPage(page, name, city)
    if (summary && hasWikiFacts(summary)) return summary
  }
  for (const hit of hits) {
    if (hit.title === name || hit.title.startsWith(`${name} (`)) continue
    const snippet = plainSnippet(hit.snippet)
    if (!snippet.includes(name)) continue
    const located = city ? snippet.includes(city) : !prefecture || snippet.includes(prefecture)
    if (!located) continue
    const summary = summaryFromMention(name, hit.title, snippet)
    if (summary) return summary
  }
  const mentionTitles = hits
    .filter((hit) => hit.title !== name && !hit.title.startsWith(`${name} (`) && plainSnippet(hit.snippet).includes(name))
    .map((hit) => hit.title)
    .slice(0, 2)
  const mentionPages = await wikiTexts(mentionTitles)
  for (const page of mentionPages) {
    if (city && !page.text.includes(city)) continue
    if (!city && prefecture && !page.text.includes(prefecture)) continue
    const ranked = mentionSentences(page.text, name)
      .map((sentence) => summaryFromMention(name, page.title, sentence))
      .filter((summary): summary is WikiSummary => summary !== null)
      .sort((a, b) => Number(b.period !== '特になし') + Number(b.size !== '特になし') - (Number(a.period !== '特になし') + Number(a.size !== '特になし')))
    if (ranked[0]) return ranked[0]
  }
  return {
    title: name,
    url: '',
    period: '特になし',
    size: '特になし',
    notes: '特になし',
    sources: [],
  }
}

const EMPTY_SUMMARY = (name: string): WikiSummary => ({
  title: name,
  url: '',
  period: '特になし',
  size: '特になし',
  notes: '特になし',
  sources: [],
})

function wikiApiUrl(params: Record<string, string>) {
  const url = new URL('https://www.wikidata.org/w/api.php')
  url.searchParams.set('origin', '*')
  url.searchParams.set('format', 'json')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

function centuryLabel(time: string, precision: number) {
  const year = Number(time.slice(1, 5))
  if (!Number.isFinite(year) || year <= 0) return ''
  if (precision <= 7) return `${Math.ceil(year / 100)}世紀`
  if (precision === 8) return `${year}年代`
  return `${year}年`
}

async function wikidataLabels(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map<string, string>()
  const response = await fetch(
    wikiApiUrl({
      action: 'wbgetentities',
      ids: unique.join('|'),
      props: 'labels',
      languages: 'ja',
    }),
  )
  if (!response.ok) return new Map<string, string>()
  const data = (await response.json()) as {
    entities?: Record<string, { labels?: { ja?: { value?: string } } }>
  }
  return new Map(
    Object.entries(data.entities ?? {}).map(([id, entity]) => [id, entity.labels?.ja?.value ?? '']),
  )
}

async function fetchWikidata(name: string): Promise<Pick<WikiSummary, 'period' | 'size' | 'notes' | 'url'> | null> {
  const search = await fetch(
    wikiApiUrl({
      action: 'wbsearchentities',
      search: name,
      language: 'ja',
      limit: '5',
    }),
  )
  if (!search.ok) return null
  const found = (await search.json()) as {
    search?: { id: string; label?: string; description?: string; match?: { text?: string } }[]
  }
  const hit = (found.search ?? []).find((item) => {
    const label = item.label ?? ''
    const alias = item.match?.text ?? ''
    const description = item.description ?? ''
    const named = label === name || alias === name || label.includes(name) || alias.includes(name)
    return named && /古墳|墳墓|陵|kofun|burial/i.test(`${label}${description}${alias}`)
  })
  if (!hit) return null
  const entityResponse = await fetch(
    wikiApiUrl({
      action: 'wbgetentities',
      ids: hit.id,
      props: 'claims',
      languages: 'ja',
    }),
  )
  if (!entityResponse.ok) return null
  const entity = (await entityResponse.json()) as {
    entities?: Record<string, { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>
  }
  const claims = entity.entities?.[hit.id]?.claims ?? {}
  const time = claims.P571?.[0]?.mainsnak?.datavalue?.value as { time?: string; precision?: number } | undefined
  const length = claims.P2043?.[0]?.mainsnak?.datavalue?.value as { amount?: string; unit?: string } | undefined
  const kinds = (claims.P31 ?? []).flatMap((claim) => {
    const value = claim.mainsnak?.datavalue?.value as { id?: string } | undefined
    return value?.id ? [value.id] : []
  })
  const heritage = (claims.P1435 ?? []).flatMap((claim) => {
    const value = claim.mainsnak?.datavalue?.value as { id?: string } | undefined
    return value?.id ? [value.id] : []
  })
  const labels = await wikidataLabels([...kinds, ...heritage])
  const shape =
    kinds
      .map((id) => labels.get(id) ?? '')
      .find((label) => /前方後円墳|円墳|方墳|上円下方墳/.test(label) && !label.endsWith('群')) ?? ''
  const meters = length?.unit?.endsWith('Q11573') ? Number(length.amount) : Number.NaN
  const designations = heritage.map((id) => labels.get(id) ?? '').filter(Boolean)
  const period = time?.time ? centuryLabel(time.time, time.precision ?? 9) : ''
  const size = [shape, Number.isFinite(meters) ? `墳丘長${Math.round(meters)}m` : ''].filter(Boolean).join('、')
  const notes = designations.join('、')
  if (!period && !size && !notes) return null
  return {
    period,
    size,
    notes,
    url: `https://www.wikidata.org/wiki/${hit.id}`,
  }
}

const infoCache = new Map<string, Promise<WikiSummary>>()

export function fetchKofunInfo(name: string, address: string, localNote = ''): Promise<WikiSummary> {
  const key = `${name}\n${address}\n${localNote}`
  const cached = infoCache.get(key)
  if (cached) return cached
  const pending = loadKofunInfo(name, address, localNote)
  infoCache.set(key, pending)
  return pending
}

async function loadKofunInfo(name: string, address: string, localNote: string): Promise<WikiSummary> {
  let summary = EMPTY_SUMMARY(name)
  try {
    summary = await fetchWiki(name, address)
  } catch {
    summary = EMPTY_SUMMARY(name)
  }
  let data: Awaited<ReturnType<typeof fetchWikidata>> = null
  if (summary.period === '特になし' && summary.size === '特になし') {
    try {
      data = await fetchWikidata(name)
    } catch {
      data = null
    }
  }
  const sources = [...summary.sources]
  if (data && summary.period === '特になし' && data.period) {
    summary = { ...summary, period: data.period }
    sources.push('Wikidata')
  }
  if (data && summary.size === '特になし' && data.size) {
    summary = { ...summary, size: data.size }
    if (!sources.includes('Wikidata')) sources.push('Wikidata')
  }
  if (summary.notes === '特になし' && data?.notes) {
    summary = { ...summary, notes: data.notes }
    if (!sources.includes('Wikidata')) sources.push('Wikidata')
  } else if (summary.notes === '特になし' && localNote) {
    summary = { ...summary, notes: localNote }
    sources.push('アプリ内の説明')
  }
  if (!summary.url && data?.url) summary = { ...summary, url: data.url }
  return { ...summary, sources }
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

async function municipalityAt(lat: number, lng: number) {
  const response = await fetch(
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`,
  )
  if (!response.ok) return null
  const data = (await response.json()) as { results?: { muniCd?: string; lv01Nm?: string } }
  const municipality = await municipalityName(data.results?.muniCd ?? '')
  if (!municipality) return null
  return { ...municipality, block: data.results?.lv01Nm ?? '' }
}

async function addressAt(lat: number, lng: number) {
  const place = await municipalityAt(lat, lng)
  if (!place) return ''
  return `${place.prefecture}${place.city}${place.block}`
}

function stationGroups(stations: { title: string; lat: number; lng: number }[]) {
  const groups: { title: string; lat: number; lng: number }[][] = []
  for (const station of stations) {
    const group = groups.find((items) => items[0].title === station.title && haversineKm(items[0], station) < 1)
    if (group) group.push(station)
    else groups.push([station])
  }
  return groups
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
  const trimmed = query.trim()
  if (trimmed.endsWith('駅')) {
    const stations = candidates.filter((place) => place.title.endsWith('駅') && (place.title === trimmed || place.title.endsWith(trimmed)))
    const hits = (
      await Promise.all(
        stationGroups(stations).map(async (group) => {
          const station = group[0]
          const area = await municipalityAt(station.lat, station.lng)
          const label = area ? `${area.prefecture}${area.city} ${station.title}` : station.title
          return { label, lat: station.lat, lng: station.lng }
        }),
      )
    ).filter((place) => place.label)
    const unique = hits.filter((place, index) => hits.findIndex((item) => item.label === place.label) === index)
    if (unique.length > 0) return unique
  }
  const chosen =
    candidates.find((place) => place.title === trimmed || place.title.endsWith(trimmed)) ??
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
