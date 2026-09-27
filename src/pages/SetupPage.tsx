import { useMemo, useState } from 'react'
import { KofunFacts } from '../components/KofunFacts.tsx'
import { MapView } from '../components/MapView.tsx'
import { kofunFromLabel, nearbyKofun, openingKofun } from '../lib/course.ts'
import { searchPlaces } from '../lib/api.ts'
import type { CoursePlan, LatLng, PlaceHit, Visit } from '../types.ts'

function previewLine(line: [number, number][]) {
  if (line.length <= 80) return line
  const step = Math.ceil(line.length / 80)
  const points = line.filter((_, index) => index % step === 0)
  const last = line[line.length - 1]
  if (points[points.length - 1] !== last) points.push(last)
  return points
}

function CourseThumb({ line }: { line: [number, number][] }) {
  const points = previewLine(line)
  if (points.length < 2) return null
  const width = 88
  const height = 88
  const pad = 8
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  for (const [lat, lng] of points) {
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }
  const spanLng = maxLng - minLng || 0.001
  const spanLat = maxLat - minLat || 0.001
  const scale = Math.min((width - pad * 2) / spanLng, (height - pad * 2) / spanLat)
  const offsetX = pad + (width - pad * 2 - spanLng * scale) / 2
  const offsetY = pad + (height - pad * 2 - spanLat * scale) / 2
  const drawn = points
    .map(([lat, lng]) => {
      const x = offsetX + (lng - minLng) * scale
      const y = offsetY + (maxLat - lat) * scale
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="course-thumb" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={drawn} />
    </svg>
  )
}

type SetupPageProps = {
  start: PlaceHit | null
  targetKm: string
  person: string
  courses: CoursePlan[]
  visits: Visit[]
  busy: boolean
  error: string
  onStartChange: (place: PlaceHit) => void
  onTargetChange: (value: string) => void
  onUsePerson: (name: string) => void
  onCreate: (kind: 'loop' | 'wide' | 'out') => void
  onOpenCourse: (course: CoursePlan) => void
  onDeleteCourse: (id: string) => void
  onRenameCourse: (id: string, title: string) => void
}

export function SetupPage({
  start,
  targetKm,
  person,
  courses,
  visits,
  busy,
  error,
  onStartChange,
  onTargetChange,
  onUsePerson,
  onCreate,
  onOpenCourse,
  onDeleteCourse,
  onRenameCourse,
}: SetupPageProps) {
  const [name, setName] = useState(person)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [courseKind, setCourseKind] = useState<'loop' | 'wide' | 'out'>('loop')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [mapCourse, setMapCourse] = useState<CoursePlan | null>(null)
  const startKofun = start ? kofunFromLabel(start.label) : null
  const startIsKofun = Boolean(startKofun)
  const opening = useMemo(() => openingKofun(), [])
  const center = useMemo(() => start ?? { lat: opening.lat, lng: opening.lng }, [start, opening])
  const nearby = useMemo(() => (start ? nearbyKofun(start) : [opening]), [start, opening])

  async function locate() {
    setSearchError('')
    if (!navigator.geolocation) {
      setSearchError('このブラウザでは現在地を取れません。地名を検索してください。')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onStartChange({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: '今いる場所',
        })
      },
      () => setSearchError('現在地を取れませんでした。地名を検索するか、地図の起点を動かしてください。'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function search() {
    setSearchError('')
    setSearching(true)
    try {
      const places = await searchPlaces(query)
      setHits(places)
      if (places.length === 0) {
        setSearchError('その地名は見つかりませんでした。')
      } else if (places.length === 1) {
        onStartChange(places[0])
      }
    } catch (caught) {
      setSearchError(caught instanceof Error ? caught.message : '地名を探せませんでした。')
    } finally {
      setSearching(false)
    }
  }

  function moveStart(point: LatLng) {
    onStartChange({ ...point, label: '地図で選んだ地点' })
  }

  return (
    <section className="page">
      <header>
        <p className="step">1 / 3</p>
        <h1>古墳マラソン</h1>
      </header>
      <label>
        あなたの名前
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 山田" />
      </label>
      <button type="button" className="secondary" onClick={() => onUsePerson(name)}>
        この名前で使う
      </button>
      <p className="muted">
        {person
          ? `${person} さんのコースと訪れた古墳を表示しています。保存したコースは、別のスマホでも同じ名前で出ます。`
          : '名前を入れると、その人の保存したコースを、別のスマホでも同じ名前で見られます。'}
      </p>
      <label>
        地名
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="行田市、二子山古墳" />
      </label>
      <div className="row">
        <button type="button" onClick={() => void search()} disabled={searching || query.trim() === ''}>
          地名を探す
        </button>
        <button type="button" className="secondary" onClick={locate}>
          今いる場所
        </button>
      </div>
      {hits.length > 1 && (
        <p className="muted">
          {hits.some((hit) => start?.label === hit.label)
            ? '「選択中」と出ているものが起点です。別のものにするときは、一覧から選び直してください。'
            : '同じ名前が複数あります。起点にするものを選んでください。'}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="list">
          {hits.map((hit) => {
            const picked = start?.label === hit.label
            return (
              <li key={`${hit.lat}-${hit.lng}`} className={picked ? 'picked' : undefined}>
                <button
                  type="button"
                  className="text-button"
                  aria-pressed={picked}
                  onClick={() => onStartChange(hit)}
                >
                  {picked && <span className="picked-mark">選択中</span>}
                  {hit.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted">{start ? `起点: ${start.label}` : '起点が未設定です。地名か現在地を選んでください。'}</p>
      {startKofun && (
        <div className="group">
          <p className="muted">起点の古墳</p>
          <KofunFacts name={startKofun.name} address={startKofun.address} />
        </div>
      )}
      <p className="muted">起点は地図上でドラッグして動かせます。</p>
      <MapView
        center={center}
        start={start}
        stops={[]}
        nearby={nearby.map((kofun) => ({ ...kofun, selected: false, labeled: !start && kofun.id === opening.id }))}
        line={[]}
        user={null}
        draggable
        onStartChange={moveStart}
      />
      {startIsKofun && (
        <div className="group">
          <p className="muted">起点が古墳です。コースの形を選んでください。</p>
          <div className="row">
            <button type="button" className={courseKind === 'loop' ? undefined : 'secondary'} onClick={() => setCourseKind('loop')}>
              周回コース
            </button>
            <button type="button" className={courseKind === 'wide' ? undefined : 'secondary'} onClick={() => setCourseKind('wide')}>
              大回りの一周
            </button>
            <button type="button" className={courseKind === 'out' ? undefined : 'secondary'} onClick={() => setCourseKind('out')}>
              行って帰りの一本道
            </button>
          </div>
        </div>
      )}
      {(!startIsKofun || courseKind === 'loop' || courseKind === 'wide') && (
        <div className="group">
          <label>
            走りたい距離（km）
            <input
              inputMode="decimal"
              value={targetKm}
              onChange={(event) => onTargetChange(event.target.value)}
            />
          </label>
          <p className="muted">
            {startIsKofun && courseKind === 'loop'
              ? '選んだ古墳を中心に回ります。最大5周です。5周で希望の距離を超えるときは、適した周回数にします。5周でも届かないときは、5周のままにします。'
              : startIsKofun && courseKind === 'wide'
                ? '近くの古墳を大きく一周し、希望の距離以上で、1kmを超えないコースを作ります。その距離になる古墳がないときは、その旨を出します。'
                : '出発した場所に戻る道を作り、希望の距離以上で1kmを超えない古墳を勧めます。その距離になる古墳がないときは、その旨を出します。'}
          </p>
        </div>
      )}
      {(error || searchError) && <p className="error">{error || searchError}</p>}
      <button
        type="button"
        onClick={() => onCreate(startIsKofun ? courseKind : 'loop')}
        disabled={busy || !start}
      >
        {busy ? 'コースを作成中' : 'コースを作る'}
      </button>

      <h2>保存したコース</h2>
      {courses.length === 0 ? (
        <p className="muted">保存したコースはここに出ます。最大20本です。</p>
      ) : (
        <ul className="list">
          {courses.map((course) => (
            <li key={course.id} className="saved-row">
              <div className="saved-main">
              {editingId === course.id ? (
                <>
                  <label>
                    コースの名前
                    <input
                      value={draftTitle}
                      maxLength={40}
                      onChange={(event) => setDraftTitle(event.target.value)}
                    />
                  </label>
                  <div className="row">
                    <button
                      type="button"
                      onClick={() => {
                        const nextTitle = draftTitle.trim()
                        onRenameCourse(course.id, nextTitle)
                        if (nextTitle && nextTitle.length <= 40) setEditingId(null)
                      }}
                    >
                      この名前にする
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEditingId(null)
                        setDraftTitle('')
                      }}
                    >
                      やめる
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" className="text-button" onClick={() => onOpenCourse(course)}>
                    {course.title}
                  </button>
                  <div className="row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEditingId(course.id)
                        setDraftTitle(course.title)
                      }}
                    >
                      名前を変える
                    </button>
                    <button type="button" className="secondary" onClick={() => onDeleteCourse(course.id)}>
                      消す
                    </button>
                  </div>
                </>
              )}
              </div>
              {course.line.length > 1 && (
                <button
                  type="button"
                  className="thumb-button"
                  aria-label={`${course.title}の地図を大きく見る`}
                  onClick={() => setMapCourse(course)}
                >
                  <CourseThumb line={course.line} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {mapCourse && (
        <div className="map-sheet">
          <div className="split">
            <h2>{mapCourse.title}</h2>
            <button type="button" className="secondary" onClick={() => setMapCourse(null)}>
              閉じる
            </button>
          </div>
          <MapView
            center={mapCourse.start}
            start={mapCourse.start}
            stops={mapCourse.stops}
            nearby={[]}
            line={mapCourse.line}
            user={null}
            draggable={false}
          />
        </div>
      )}

      <h2>訪れた古墳</h2>
      {visits.length === 0 ? (
        <p className="muted">着いた古墳はここに残り続けます。コースを消しても消えません。</p>
      ) : (
        <ul className="list">
          {visits.map((visit) => (
            <li key={visit.id}>
              <strong>{visit.name}</strong>
              <p className="muted">
                {new Date(visit.visitedAt).toLocaleDateString('ja-JP')} · {visit.address}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="credit">
        地図 © OpenStreetMap contributors。古墳の位置は『日本歴史地名大系』施設・地点項目データセット（人文学オープンデータ共同利用センター、CC BY 4.0）によります。
      </p>
    </section>
  )
}
