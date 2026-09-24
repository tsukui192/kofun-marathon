import { useEffect, useRef, useState } from 'react'
import { MapView } from '../components/MapView.tsx'
import { formatKm, haversineKm } from '../lib/geo.ts'
import { recordVisit } from '../lib/storage.ts'
import type { CoursePlan, CourseStop, LatLng } from '../types.ts'

const START_LIMIT_KM = 0.5
const CHECK_KM = 0.1

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
  const [checked, setChecked] = useState<CourseStop[]>(initialStop ? [initialStop] : [])
  const [active, setActive] = useState<CourseStop | null>(initialStop ?? null)
  const [gpsError, setGpsError] = useState('')
  const checkedIds = useRef(new Set(initialStop ? [initialStop.id] : []))
  const startedRef = useRef(Boolean(initialStop))
  const [started, setStarted] = useState(Boolean(initialStop))
  const onVisitedRef = useRef(onVisited)
  onVisitedRef.current = onVisited
  const awayKm = user ? haversineKm(user, course.start) : null
  const canRun = started || (awayKm !== null && awayKm <= START_LIMIT_KM)

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
    let last: LatLng | null = null
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lng: position.coords.longitude }
        setUser(next)
        setGpsError('')
        if (haversineKm(next, course.start) <= START_LIMIT_KM && !startedRef.current) {
          startedRef.current = true
          setStarted(true)
        }
        if (startedRef.current && last) {
          const step = haversineKm(last, next)
          if (step > 0.005 && step < 0.2) setRunKm((km) => km + step)
        }
        last = next
        for (const stop of course.stops) {
          if (haversineKm(next, stop) > CHECK_KM || checkedIds.current.has(stop.id)) continue
          checkedIds.current.add(stop.id)
          recordVisit({
            id: stop.id,
            name: stop.name,
            address: stop.address,
            note: stop.note,
            visitedAt: new Date().toISOString(),
          })
          onVisitedRef.current()
          setActive(stop)
          setChecked((current) => [...current, stop])
        }
      },
      () => {
        if (!initialStop) setGpsError('現在地を取れませんでした。位置情報を許可してください。')
      },
      { enableHighAccuracy: true, maximumAge: 2000 },
    )
    return () => navigator.geolocation.clearWatch(watch)
  }, [course, initialStop])

  return (
    <section className="page">
      <header>
        <p className="step">3 / 3</p>
        <h1>走行中</h1>
      </header>
      <p className="distance">
        {formatKm(runKm)}
        <span>コース {formatKm(course.distanceKm)}</span>
      </p>
      {!canRun && (
        <p className="error">
          {awayKm === null
            ? '現在地を確認しています。起点の近くに来てから走ります。'
            : `起点まで約 ${formatKm(awayKm)} あります。近くに来てから走ってください。`}
        </p>
      )}
      {gpsError && <p className="error">{gpsError}</p>}
      <MapView
        center={course.start}
        start={course.start}
        stops={course.stops}
        nearby={[]}
        line={course.line}
        user={user}
        draggable={false}
      />
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
            <li key={stop.id}>
              <strong>
                {done ? '済' : index + 1} {stop.name}
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
