import { useEffect, useRef, useState } from 'react'
import { MapView } from '../components/MapView.tsx'
import { fetchRoute } from '../lib/api.ts'
import { distanceToLineKm, formatKm, haversineKm, lineProgressKm, measureStep, remainingFromHere } from '../lib/geo.ts'
import { recordVisit } from '../lib/storage.ts'
import type { CoursePlan, CourseStop, LatLng } from '../types.ts'

const START_LIMIT_KM = 0.5
const CHECK_KM = 0.01
const OFF_ROUTE_KM = 0.08
const MAP_SIZES = [
  { id: 'small', label: '小さく', className: 'map-small' },
  { id: 'medium', label: 'ふつう', className: 'map-medium' },
  { id: 'large', label: '大きく', className: 'map-large' },
] as const

function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remain = seconds % 60
  const ss = String(remain).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
}

type RunPageProps = {
  course: CoursePlan
  onExit: () => void
  onVisited: () => void
  initialStop?: CourseStop
  initialKm?: number
}

export function RunPage({ course, onExit, onVisited, initialStop, initialKm = 0 }: RunPageProps) {
  const [user, setUser] = useState<LatLng | null>(initialStop ?? null)
  const [runKm, setRunKm] = useState(initialKm)
  const [line, setLine] = useState(course.line)
  const [track, setTrack] = useState<[number, number][]>([])
  const [reviseNote, setReviseNote] = useState('')
  const [arrivalNote, setArrivalNote] = useState('')
  const [lapsDone, setLapsDone] = useState(0)
  const [rerouted, setRerouted] = useState(false)
  const [checked, setChecked] = useState<CourseStop[]>(initialStop ? [initialStop] : [])
  const [active, setActive] = useState<CourseStop | null>(initialStop ?? null)
  const [gpsError, setGpsError] = useState('')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [mapSize, setMapSize] = useState<(typeof MAP_SIZES)[number]['id']>('medium')
  const checkedIds = useRef(new Set(initialStop ? [initialStop.id] : []))
  const startedRef = useRef(Boolean(initialStop))
  const [started, setStarted] = useState(Boolean(initialStop))
  const lineRef = useRef(course.line)
  const revisingRef = useRef(false)
  const revisedAtRef = useRef(0)
  const progressRef = useRef(0)
  const reroutedRef = useRef(false)
  const courseRef = useRef(course)
  courseRef.current = course
  const onVisitedRef = useRef(onVisited)
  onVisitedRef.current = onVisited
  const awayKm = user ? haversineKm(user, course.start) : null
  const canRun = started || (awayKm !== null && awayKm <= START_LIMIT_KM)

  useEffect(() => {
    if (!started) return
    const startedAt = Date.now()
    const tick = () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const timer = window.setInterval(tick, 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [started])

  useEffect(() => {
    lineRef.current = course.line
    setLine(course.line)
    setReviseNote('')
    setLapsDone(0)
    setRerouted(false)
    reroutedRef.current = false
    progressRef.current = 0
  }, [course])

  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        lock = null
      }
    }
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) {
      if (!initialStop) setGpsError('このブラウザでは現在地を取れません。')
      return
    }
    let anchor: { point: LatLng; at: number } | null = null
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude }
        const at = position.timestamp || Date.now()
        setUser(next)
        setGpsError('')
        if (haversineKm(next, course.start) <= START_LIMIT_KM && !startedRef.current) {
          startedRef.current = true
          setStarted(true)
        }
        if (startedRef.current && anchor) {
          const step = measureStep(anchor.point, anchor.at, next, at, position.coords.accuracy)
          if (step.accept) {
            if (step.addKm > 0) {
              const from = anchor.point
              setRunKm((km) => km + step.addKm)
              setTrack((current) =>
                current.length === 0
                  ? [
                      [from.lat, from.lng],
                      [next.lat, next.lng],
                    ]
                  : [...current, [next.lat, next.lng]],
              )
            }
            anchor = { point: next, at }
          }
        } else if (startedRef.current) {
          anchor = { point: next, at }
        }
        const progress = lineProgressKm(next, lineRef.current)
        const planLaps = courseRef.current.laps ?? 1
        if (!reroutedRef.current && planLaps > 1 && progress.totalKm > 0) {
          const fraction = progress.alongKm / progress.totalKm
          if (progressRef.current > 0.75 && fraction < 0.2) {
            setLapsDone((done) => Math.min(planLaps - 1, done + 1))
          }
          progressRef.current = fraction
        }
        if (
          startedRef.current &&
          !revisingRef.current &&
          Date.now() - revisedAtRef.current > 20000 &&
          distanceToLineKm(next, lineRef.current) > OFF_ROUTE_KM
        ) {
          revisingRef.current = true
          revisedAtRef.current = Date.now()
          const plan = courseRef.current
          const remaining = plan.stops.filter(
            (stop) => !checkedIds.current.has(stop.id) && haversineKm(next, stop) > 0.03,
          )
          const coordinates: [number, number][] = [
            [next.lng, next.lat],
            ...remaining.map((stop) => [stop.lng, stop.lat] as [number, number]),
            [plan.start.lng, plan.start.lat],
          ]
          if (coordinates.length < 2 || (remaining.length === 0 && haversineKm(next, plan.start) < 0.03)) {
            revisingRef.current = false
            return
          }
          void fetchRoute(coordinates)
            .then((route) => {
              lineRef.current = route.line
              setLine(route.line)
              reroutedRef.current = true
              setRerouted(true)
              progressRef.current = 0
              setReviseNote('道を外れたので、ここから先の道を引き直しました。')
            })
            .catch(() => {
              setReviseNote('道を外れています。引き直しに失敗しました。このまま走ってください。')
            })
            .finally(() => {
              revisingRef.current = false
            })
        }
      },
      () => {
        if (!initialStop) setGpsError('現在地を取れませんでした。位置情報を許可してください。')
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [course, initialStop])

  useEffect(() => {
    if (!user) return
    for (const stop of course.stops) {
      if (checkedIds.current.has(stop.id) || haversineKm(user, stop) > CHECK_KM) continue
      checkedIds.current.add(stop.id)
      const saved = recordVisit({
        id: stop.id,
        name: stop.name,
        address: stop.address,
        note: stop.note,
        visitedAt: new Date().toISOString(),
      })
      if (!saved.ok) setGpsError(saved.message)
      onVisitedRef.current()
      setActive(stop)
      setChecked((current) => [...current, stop])
      setArrivalNote(`${stop.name}に到着しました。`)
    }
  }, [user, course.stops])

  const planLaps = rerouted ? 1 : Math.max(1, course.laps ?? 1)
  const remainKm = user ? remainingFromHere(user, line, planLaps, lapsDone) : course.distanceKm

  return (
    <section className="page">
      <header>
        <p className="step">3 / 3</p>
        <h1>走行中</h1>
      </header>
      <div className="run-stats">
        <p className="distance">
          {`${runKm.toFixed(2)} km`}
          <span>走った距離</span>
        </p>
        <p className="distance">
          {formatElapsed(elapsedSec)}
          <span>走った時間</span>
        </p>
      </div>
      <p className="distance">
        {`${Math.max(0, remainKm).toFixed(2)} km`}
        <span>残りの距離</span>
      </p>
      {arrivalNote && <p className="notice">{arrivalNote}</p>}
      {reviseNote && <p className="notice">{reviseNote}</p>}
      {!canRun && (
        <p className="error">
          {awayKm === null
            ? '現在地を確認しています。起点の近くに来てから走ります。'
            : `起点まで約 ${formatKm(awayKm)} あります。近くに来てから走ってください。`}
        </p>
      )}
      {gpsError && <p className="error">{gpsError}</p>}
      <div className="group">
        <p className="muted">地図の大きさ</p>
        <div className="row">
          {MAP_SIZES.map((size) => (
            <button
              key={size.id}
              type="button"
              className={mapSize === size.id ? undefined : 'secondary'}
              onClick={() => setMapSize(size.id)}
            >
              {size.label}
            </button>
          ))}
        </div>
        <MapView
          center={course.start}
          start={course.start}
          stops={course.stops}
          nearby={[]}
          line={line}
          track={track}
          user={user}
          draggable={false}
          focusMeters={started && user ? 50 : undefined}
          className={MAP_SIZES.find((size) => size.id === mapSize)?.className}
        />
      </div>
      {active && (
        <article className="card">
          <p className="muted">チェック済み</p>
          <h2>{active.name}</h2>
          <p>{active.note}</p>
          <p className="muted">{active.address}</p>
        </article>
      )}
      <ul className="list">
        {course.stops.map((stop, index) => {
          const done = checked.some((item) => item.id === stop.id)
          return (
            <li key={stop.id} className={done ? 'arrived' : undefined}>
              <strong>
                {done ? '到着' : index + 1} {stop.name}
              </strong>
              <p className="muted">{done ? '到着' : '未着'}</p>
            </li>
          )
        })}
      </ul>
      <button type="button" className="secondary" onClick={onExit}>
        入力へ戻る
      </button>
    </section>
  )
}
