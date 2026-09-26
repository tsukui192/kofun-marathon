import { useMemo, useState } from 'react'
import { KofunFacts } from '../components/KofunFacts.tsx'
import { MapView } from '../components/MapView.tsx'
import { kofunFromLabel } from '../lib/course.ts'
import { nearbyKofun } from '../lib/course.ts'
import { searchPlaces } from '../lib/api.ts'
import type { CoursePlan, LatLng, PlaceHit, Visit } from '../types.ts'

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
  onCreate: (kind: 'loop' | 'wide' | 'out', laps: number) => void
  onOpenCourse: (course: CoursePlan) => void
  onDeleteCourse: (id: string) => void
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
}: SetupPageProps) {
  const [name, setName] = useState(person)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [searchError, setSearchError] = useState('')
  const [searching, setSearching] = useState(false)
  const [courseKind, setCourseKind] = useState<'loop' | 'wide' | 'out'>('loop')
  const [laps, setLaps] = useState('1')
  const startKofun = start ? kofunFromLabel(start.label) : null
  const startIsKofun = Boolean(startKofun)
  const center = useMemo(() => start ?? { lat: 34.564, lng: 135.487 }, [start])
  const nearby = useMemo(() => (start ? nearbyKofun(start) : []), [start])

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
          ? `${person} さんのコースと訪れた古墳だけを表示しています。別の人は名前を変えてください。`
          : '名前を入れると、その人の記録だけがこのブラウザに残ります。'}
      </p>
      <label>
        地名
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="堺市、二子山古墳" />
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
        nearby={nearby.map((kofun) => ({ ...kofun, selected: false }))}
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
      {startIsKofun && courseKind === 'loop' && (
        <div className="group">
          <label>
            周回数
            <input inputMode="numeric" value={laps} onChange={(event) => setLaps(event.target.value)} />
          </label>
          <p className="muted">この古墳を中心に、まわりの道を回る回数です。1周の道を、選んだ回数だけ進みます。</p>
        </div>
      )}
      {!startIsKofun && (
        <div className="group">
          <label>
            走りたい距離（km）
            <input
              inputMode="decimal"
              value={targetKm}
              onChange={(event) => onTargetChange(event.target.value)}
            />
          </label>
          <p className="muted">出発した場所に戻る道を作り、その距離に近い古墳を勧めます。</p>
        </div>
      )}
      {(error || searchError) && <p className="error">{error || searchError}</p>}
      <button
        type="button"
        onClick={() => onCreate(startIsKofun ? courseKind : 'loop', Number(laps))}
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
