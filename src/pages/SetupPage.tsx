import { useMemo, useState } from 'react'
import { MapView } from '../components/MapView.tsx'
import { loopKm, nearbyKofun, orderLoop } from '../lib/course.ts'
import { searchPlaces } from '../lib/api.ts'
import { formatKm } from '../lib/geo.ts'
import type { CoursePlan, Kofun, LatLng, PlaceHit, Visit } from '../types.ts'

type SetupPageProps = {
  start: PlaceHit | null
  courses: CoursePlan[]
  visits: Visit[]
  busy: boolean
  error: string
  onStartChange: (place: PlaceHit) => void
  onCreate: (selected: Kofun[]) => void
  onOpenCourse: (course: CoursePlan) => void
  onDeleteCourse: (id: string) => void
}

export function SetupPage({
  start,
  courses,
  visits,
  busy,
  error,
  onStartChange,
  onCreate,
  onOpenCourse,
  onDeleteCourse,
}: SetupPageProps) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const center = useMemo(() => start ?? { lat: 34.564, lng: 135.487 }, [start])
  const nearby = useMemo(() => (start ? nearbyKofun(start) : []), [start])
  const selected = useMemo(
    () => nearby.filter((kofun) => selectedIds.includes(kofun.id)),
    [nearby, selectedIds],
  )
  const estimateKm = useMemo(
    () => (start && selected.length > 0 ? loopKm(start, orderLoop(start, selected)) : null),
    [start, selected],
  )

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
      } else {
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

  function toggleKofun(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  return (
    <section className="page">
      <header>
        <p className="step">1 / 3</p>
        <h1>古墳マラソン</h1>
      </header>
      <label>
        地名
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="堺市" />
      </label>
      <div className="row">
        <button type="button" onClick={() => void search()} disabled={searching || query.trim() === ''}>
          地名を探す
        </button>
        <button type="button" className="secondary" onClick={locate}>
          今いる場所
        </button>
      </div>
      {hits.length > 0 && (
        <ul className="list">
          {hits.map((hit) => (
            <li key={`${hit.lat}-${hit.lng}`}>
              <button type="button" className="text-button" onClick={() => onStartChange(hit)}>
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">{start ? `起点: ${start.label}` : '起点が未設定です。地名か現在地を選んでください。'}</p>
      <p className="muted">起点は地図上でドラッグして動かせます。</p>
      <MapView
        center={center}
        start={start}
        stops={[]}
        nearby={nearby.map((kofun) => ({ ...kofun, selected: selectedIds.includes(kofun.id) }))}
        line={[]}
        user={null}
        draggable
        onStartChange={moveStart}
        onNearbyClick={toggleKofun}
      />
      <h2>回りたい古墳</h2>
      {!start ? (
        <p className="muted">起点を選ぶと、近くの古墳が出ます。</p>
      ) : nearby.length === 0 ? (
        <p className="muted">この近くには古墳が見つかりませんでした。</p>
      ) : (
        <ul className="list">
          {nearby.map((kofun) => {
            const picked = selectedIds.includes(kofun.id)
            return (
              <li key={kofun.id}>
                <button
                  type="button"
                  className="text-button"
                  aria-pressed={picked}
                  onClick={() => toggleKofun(kofun.id)}
                >
                  <strong>{picked ? '選択中 · ' : ''}{kofun.name}</strong>
                  <span className="muted">{kofun.address}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted">
        {estimateKm === null
          ? '地図か一覧から、回りたい古墳を選んでください。選んだ古墳を最短の順で回り、起点に戻ります。'
          : `選んだ ${selected.length} 基の目安は ${formatKm(estimateKm)} です。道に沿った距離はコース作成後に出ます。`}
      </p>
      {(error || searchError) && <p className="error">{error || searchError}</p>}
      <button type="button" onClick={() => onCreate(selected)} disabled={busy || !start || selected.length === 0}>
        {busy ? 'コースを作成中' : '最適ルートを作る'}
      </button>

      <h2>保存したコース</h2>
      {courses.length === 0 ? (
        <p className="muted">保存したコースはここに出ます。最大20本です。</p>
      ) : (
        <ul className="list">
          {courses.map((course) => (
            <li key={course.id} className="split">
              <button type="button" className="text-button" onClick={() => onOpenCourse(course)}>
                {course.title}
              </button>
              <button type="button" className="secondary" onClick={() => onDeleteCourse(course.id)}>
                消す
              </button>
            </li>
          ))}
        </ul>
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
