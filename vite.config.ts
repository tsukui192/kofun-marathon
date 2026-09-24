import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

type LngLat = [number, number]

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

async function routeWithOrs(key: string, coordinates: LngLat[]) {
  const response = await fetch(
    'https://api.openrouteservice.org/v2/directions/foot-walking/geojson',
    {
      method: 'POST',
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ coordinates }),
    },
  )
  if (!response.ok) {
    throw new Error(`道順サービスが応答しませんでした (${response.status})`)
  }
  const data = (await response.json()) as {
    features?: { geometry: { coordinates: LngLat[] }; properties: { summary: { distance: number } } }[]
  }
  const feature = data.features?.[0]
  if (!feature) throw new Error('道順が見つかりませんでした')
  return {
    engine: 'openrouteservice' as const,
    distanceMeters: feature.properties.summary.distance,
    line: feature.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LngLat),
  }
}

async function routeWithOsrm(coordinates: LngLat[]) {
  const path = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/foot/${path}?overview=full&geometries=geojson`,
  )
  if (!response.ok) {
    throw new Error(`道順サービスが応答しませんでした (${response.status})`)
  }
  const data = (await response.json()) as {
    code?: string
    routes?: { distance: number; geometry: { coordinates: LngLat[] } }[]
  }
  const route = data.routes?.[0]
  if (data.code !== 'Ok' || !route) throw new Error('道順が見つかりませんでした')
  return {
    engine: 'osrm' as const,
    distanceMeters: route.distance,
    line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as LngLat),
  }
}

const WIKI_HEADERS = {
  'User-Agent': 'KofunMarathon/0.1 (educational; https://ja.wikipedia.org/)',
  Accept: 'application/json',
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

async function wikiFetch(url: URL) {
  let lastError = 'ウィキペディアを参照できませんでした。'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: WIKI_HEADERS })
      if (response.ok) return response
      lastError = `ウィキペディアを参照できませんでした。（${response.status}）`
      if (response.status !== 429 && response.status < 500) break
    } catch {
      lastError = 'ウィキペディアを参照できませんでした。'
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw new Error(lastError)
}

async function wikiSearch(query: string) {
  const searchUrl = new URL('https://ja.wikipedia.org/w/api.php')
  searchUrl.searchParams.set('action', 'query')
  searchUrl.searchParams.set('list', 'search')
  searchUrl.searchParams.set('srsearch', query)
  searchUrl.searchParams.set('srlimit', '8')
  searchUrl.searchParams.set('format', 'json')
  searchUrl.searchParams.set('utf8', '1')
  const response = await wikiFetch(searchUrl)
  const data = (await response.json()) as {
    query?: { search?: { title: string; snippet: string }[] }
  }
  return data.query?.search ?? []
}

async function wikiText(title: string) {
  const url = new URL('https://ja.wikipedia.org/w/api.php')
  url.searchParams.set('action', 'query')
  url.searchParams.set('prop', 'revisions')
  url.searchParams.set('rvprop', 'content')
  url.searchParams.set('rvslots', 'main')
  url.searchParams.set('titles', title)
  url.searchParams.set('format', 'json')
  url.searchParams.set('utf8', '1')
  url.searchParams.set('redirects', '1')
  let response: Response
  try {
    response = await wikiFetch(url)
  } catch {
    return null
  }
  const data = (await response.json()) as {
    query?: { pages?: Record<string, { title?: string; missing?: string; revisions?: { slots?: { main?: { '*'?: string } } }[] }> }
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
  const plain = stripWiki(`${lead}\n${overview}`)
  return plain
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

function summarizeKofun(title: string, text: string) {
  const period = wikiField(text, '築造年代') || wikiField(text, '築造時期')
  const shape = wikiField(text, '形状')
  const scale = wikiField(text, '規模') || wikiField(text, '墳長') || wikiField(text, '墳丘長')
  const size = [shape, scale].filter(Boolean).join('、')
  const notes = famousNotes(text)
  return {
    title,
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    period: period || '記事に年代の記載がありません。',
    size: size || '記事にサイズの記載がありません。',
    notes: notes || '記事に、なぜ知られているかの記載がありません。',
  }
}

async function wikiSummary(name: string, address: string) {
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
    return summarizeKofun(page.title, page.text)
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

async function addressAt(lat: number, lng: number) {
  const response = await fetch(
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`,
  )
  if (!response.ok) return ''
  const data = (await response.json()) as { results?: { muniCd?: string; lv01Nm?: string } }
  const code = data.results?.muniCd ?? ''
  const town = data.results?.lv01Nm ?? ''
  const municipality = await municipalityName(code)
  if (!municipality) return ''
  return `${municipality.prefecture}${municipality.city}${town}`
}

function formatGsiTitle(title: string) {
  const half = title.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  )
  return half.replace(/番地$/u, '')
}

function scoreWikiTitle(title: string, name: string, city: string) {
  if (city && title === `${name} (${city})`) return 5
  if (title === name) return 4
  if (title.startsWith(name) && city && title.includes(city)) return 3
  if (title.startsWith(name)) return 2
  return 0
}

function apiPlugin(orsKey: string): Plugin {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/api/geocode' && req.method === 'GET') {
        const q = url.searchParams.get('q')?.trim() ?? ''
        if (!q) {
          sendJson(res, 400, { error: '地名を入力してください。' })
          return
        }
        const search = new URL('https://msearch.gsi.go.jp/address-search/AddressSearch')
        search.searchParams.set('q', q)
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
          candidates.find((place) => place.title === q || place.title.endsWith(q)) ??
          candidates.find((place) => isStreetAddress(place.title)) ??
          candidates[0]
        if (!chosen) {
          sendJson(res, 200, [])
          return
        }
        const label = isStreetAddress(chosen.title) ? chosen.title : await addressAt(chosen.lat, chosen.lng)
        sendJson(res, 200, label ? [{ label, lat: chosen.lat, lng: chosen.lng }] : [])
        return
      }

      if (url.pathname === '/api/wiki' && req.method === 'GET') {
        const name = url.searchParams.get('name')?.trim() ?? ''
        const address = url.searchParams.get('address')?.trim() ?? ''
        if (!name) {
          sendJson(res, 400, { error: '古墳の名前がありません。' })
          return
        }
        sendJson(res, 200, await wikiSummary(name, address))
        return
      }

      if (url.pathname === '/api/route' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req)) as { coordinates?: LngLat[] }
        const coordinates = body.coordinates ?? []
        if (coordinates.length < 2) {
          sendJson(res, 400, { error: '道順を作る地点が足りません。' })
          return
        }
        const route = orsKey
          ? await routeWithOrs(orsKey, coordinates)
          : await routeWithOsrm(coordinates)
        sendJson(res, 200, route)
        return
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '道順を作れませんでした。'
      sendJson(res, 502, { error: message })
      return
    }
    next()
  }

  return {
    name: 'kofun-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), apiPlugin(env.ORS_API_KEY ?? '')],
  }
})
