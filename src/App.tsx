import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { saitamaSample, saitamaSampleStop } from './data/sampleSaitama.ts'
import { fetchOptimalLoop, fetchRoute } from './lib/api.ts'
import { haversineKm, ringAreaKm2, sidePoint } from './lib/geo.ts'
import { lapsForDistance, routeAround } from './lib/around.ts'
import { fitsDistance, kofunMatching, nearbyKofun, orderLoop, rankStopSets, returnOffsets, toStops } from './lib/course.ts'
import { loadCourses, loadPerson, loadVisits, rememberPerson, removeAndUnshare, renameAndShare, saveAndShare, syncCourses } from './lib/storage.ts'
import { CoursePage } from './pages/CoursePage.tsx'
import { RunPage } from './pages/RunPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import type { CoursePlan, CourseStop, Kofun, PlaceHit, Visit } from './types.ts'

type Page = 'setup' | 'course' | 'run'
type CourseKind = 'loop' | 'wide' | 'out'

function shortPlace(label: string): string {
  const head = label.split(',')[0]?.trim()
  return head && head.length > 0 ? head : '選んだ地点'
}

const showSaitamaSample = new URLSearchParams(window.location.search).get('sample') === 'saitama'

export default function App() {
  const [page, setPage] = useState<Page>(showSaitamaSample ? 'run' : 'setup')
  const [start, setStart] = useState<PlaceHit | null>(null)
  const [targetKm, setTargetKm] = useState('10')
  const [choices, setChoices] = useState<CourseStop[]>(showSaitamaSample ? saitamaSample.stops : [])
  const [course, setCourse] = useState<CoursePlan | null>(showSaitamaSample ? saitamaSample : null)
  const [person, setPerson] = useState(() => loadPerson())
  const [courses, setCourses] = useState<CoursePlan[]>(() => loadCourses())
  const [visits, setVisits] = useState<Visit[]>(() => loadVisits())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const refreshVisits = useCallback(() => setVisits(loadVisits()), [])
  const parsedKm = useMemo(() => Number(targetKm), [targetKm])
  const syncGeneration = useRef(0)

  const applySync = useCallback((next: string) => {
    const generation = syncGeneration.current + 1
    syncGeneration.current = generation
    return syncCourses(next).then((result) => {
      if (syncGeneration.current !== generation) return
      setCourses(result.courses)
      if (!result.ok) setError(result.message)
    })
  }, [])

  useEffect(() => {
    const current = loadPerson()
    if (current) void applySync(current)
  }, [applySync])

  async function routeThrough(place: PlaceHit, selected: CourseStop[], target: number) {
    const coordinates: [number, number][] = [
      [place.lng, place.lat],
      ...selected.map((kofun) => [kofun.lng, kofun.lat] as [number, number]),
    ]
    const localOrder = orderLoop(place, selected)
    let stops = localOrder
    let route: { distanceMeters: number; line: [number, number][] }
    try {
      const optimal = await fetchOptimalLoop(coordinates)
      const ordered = optimal.order.filter((index) => index > 0).map((index) => selected[index - 1])
      if (ordered.length !== selected.length) throw new Error('順序を確定できませんでした。')
      stops = ordered
      route = optimal
    } catch {
      route = await fetchRoute([
        [place.lng, place.lat],
        ...localOrder.map((kofun) => [kofun.lng, kofun.lat] as [number, number]),
        [place.lng, place.lat],
      ])
    }
    const excessOf = (meters: number) => (target > 0 ? meters / 1000 - target : 0)
    const inWindow = (meters: number) => fitsDistance(meters / 1000, target)
    const baseKm = route.distanceMeters / 1000
    const thin = ringAreaKm2(route.line) < 0.2
    const short = target > 0 && baseKm < target
    if (thin || short) {
      const far = selected.reduce((left, right) => (haversineKm(place, left) >= haversineKm(place, right) ? left : right))
      let opened: { distanceMeters: number; line: [number, number][] } | null = null
      let openedGap = Number.POSITIVE_INFINITY
      for (const offsetKm of returnOffsets(baseKm, target)) {
        for (const sign of [1, -1]) {
          const side = sidePoint(place, far, offsetKm, sign)
          try {
            const via = await fetchRoute([
              [place.lng, place.lat],
              ...stops.map((stop) => [stop.lng, stop.lat] as [number, number]),
              [side.lng, side.lat],
              [place.lng, place.lat],
            ])
            const grew = via.distanceMeters > route.distanceMeters + 400
            if (ringAreaKm2(via.line) < 0.2 && !grew) continue
            if (!inWindow(via.distanceMeters)) continue
            const gap = excessOf(via.distanceMeters)
            if (!opened || gap < openedGap) {
              opened = via
              openedGap = gap
            }
          } catch {
            continue
          }
        }
        if (opened && openedGap <= 0.2) break
      }
      const baseInWindow = inWindow(route.distanceMeters)
      if (opened && (target <= 0 || !baseInWindow || openedGap <= excessOf(route.distanceMeters))) route = opened
    }
    const distanceKm = route.distanceMeters / 1000
    const plan: CoursePlan = {
      id: crypto.randomUUID(),
      title: `${shortPlace(place.label)} · ${distanceKm.toFixed(1)}km`,
      createdAt: new Date().toISOString(),
      targetKm: target,
      distanceKm,
      start: place,
      stops,
      line: route.line,
    }
    return plan
  }

  async function createOutAndBack() {
    const pool = nearbyKofun(start!, 12, 6).filter((kofun) => haversineKm(start!, kofun) > 0.25)
    const kofun = pool[0]
    if (!kofun) {
      setError('この近くには、コースにできる古墳が見つかりませんでした。')
      return
    }
    const route = await fetchRoute([
      [start!.lng, start!.lat],
      [kofun.lng, kofun.lat],
      [start!.lng, start!.lat],
    ])
    const distanceKm = route.distanceMeters / 1000
    const best: CoursePlan = {
      id: crypto.randomUUID(),
      title: `${shortPlace(start!.label)} · ${distanceKm.toFixed(1)}km`,
      createdAt: new Date().toISOString(),
      targetKm: 0,
      distanceKm,
      heading: '行って帰りの一本道',
      start: start!,
      stops: toStops([kofun]),
      line: route.line,
    }
    setChoices(best.stops)
    setCourse(best)
    setPage('course')
  }

  async function createCircle(targetKm: number, heading: string) {
    const center = kofunMatching(start!)
    if (!center) {
      setError('起点の古墳が分かりません。古墳を選び直してください。')
      return
    }
    const here = { ...center, lat: start!.lat, lng: start!.lng }
    const loop = await routeAround(here, fetchRoute)
    const lapKm = loop.distanceMeters / 1000
    const chosen = lapsForDistance(lapKm, targetKm)
    const laps = chosen.laps
    const distanceKm = lapKm * laps
    const lapNote =
      chosen.fit === 'short'
        ? `${laps}周にしています。希望の距離には届きません。`
        : chosen.fit === 'over'
          ? `${laps}周で希望の距離を超えます。${laps}周にしています。`
          : `希望の距離には、${laps}周が適しています。`
    const fitMessage = loop.suited
      ? lapNote
      : `まわりの道が、古墳を中心にした輪になりません。${lapNote}`
    const plan: CoursePlan = {
      id: crypto.randomUUID(),
      title: `${shortPlace(start!.label)} · ${distanceKm.toFixed(1)}km · ${laps}周`,
      createdAt: new Date().toISOString(),
      targetKm,
      distanceKm,
      laps,
      fitMessage: fitMessage || undefined,
      heading,
      start: start!,
      stops: toStops([here]),
      line: loop.line,
    }
    setChoices([])
    setCourse(plan)
    setPage('course')
  }

  async function createCourse(kind: CourseKind = 'loop') {
    setError('')
    setSaveMessage('')
    if (!person) {
      setError('先に名前を入れて「この名前で使う」を押してください。')
      return
    }
    if (!start) {
      setError('起点を選んでください。')
      return
    }
    const circling = kind === 'loop' && Boolean(kofunMatching(start))
    if ((kind === 'loop' || kind === 'wide') && (!Number.isFinite(parsedKm) || parsedKm < 1 || parsedKm > 50)) {
      setError('距離は1から50のkmで入力してください。')
      return
    }
    setBusy(true)
    try {
      if (kind === 'out') {
        await createOutAndBack()
        return
      }
      if (circling) {
        await createCircle(parsedKm, '周回コース')
        return
      }
      const sets = rankStopSets(start, parsedKm)
      if (sets.length === 0) {
        setError('希望の距離以上で、1kmを超えない古墳が、この近くにはありません。')
        return
      }
      let best: CoursePlan | null = null
      let bestSet: Kofun[] = []
      for (const set of sets) {
        const plan = await routeThrough(start, toStops(set), parsedKm)
        if (!fitsDistance(plan.distanceKm, parsedKm)) continue
        best = plan
        bestSet = set
        break
      }
      if (!best || !fitsDistance(best.distanceKm, parsedKm)) {
        setError('希望の距離以上で、1kmを超えない古墳が、この近くにはありません。')
        return
      }
      setChoices(toStops(bestSet))
      setCourse({ ...best, heading: kind === 'wide' ? '大回りの一周' : '周回コース' })
      setPage('course')
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : '道順を作れませんでした。しばらくしてからもう一度試してください。',
      )
    } finally {
      setBusy(false)
    }
  }

  async function reviseCourse(selectedIds: string[]) {
    if (!course) return
    const selected = choices.filter((stop) => selectedIds.includes(stop.id))
    if (selected.length === 0) {
      setError('回りたい古墳を1基以上選んでください。')
      return
    }
    setError('')
    setBusy(true)
    try {
      const plan = await routeThrough(course.start, selected, course.targetKm)
      if (course.targetKm > 0 && !fitsDistance(plan.distanceKm, course.targetKm)) {
        setError('この組み合わせでは、希望の距離以上で1km以内になりません。')
        return
      }
      setCourse({ ...plan, id: course.id, createdAt: course.createdAt, heading: course.heading })
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : '道順を作れませんでした。しばらくしてからもう一度試してください。',
      )
    } finally {
      setBusy(false)
    }
  }

  function usePerson(name: string) {
    const result = rememberPerson(name)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const next = name.trim()
    setPerson(next)
    setCourses(loadCourses(next))
    setVisits(loadVisits(next))
    setError('')
    setSaveMessage('')
    void applySync(next)
  }

  async function storeCourse() {
    if (!course) return
    const result = await saveAndShare(course)
    setCourses(loadCourses())
    setSaveMessage(result.ok ? '保存しました。別のスマホでも、同じ名前で見られます。' : result.message)
  }

  async function removeCourse(id: string) {
    const result = await removeAndUnshare(id)
    setCourses(loadCourses())
    if (!result.ok) setError(result.message)
  }

  async function renameCourse(id: string, title: string) {
    const result = await renameAndShare(id, title)
    const next = loadCourses()
    setCourses(next)
    setCourse((current) => {
      if (!current || current.id !== id) return current
      return next.find((item) => item.id === id) ?? current
    })
    setError(result.ok ? '' : result.message)
  }

  return (
    <main>
      {page === 'setup' && (
        <SetupPage
          start={start}
          targetKm={targetKm}
          person={person}
          courses={courses}
          visits={visits}
          busy={busy}
          error={error}
          onStartChange={(place) => {
            setStart(place)
            setError('')
          }}
          onTargetChange={setTargetKm}
          onUsePerson={usePerson}
          onCreate={(kind) => void createCourse(kind)}
          onOpenCourse={(saved) => {
            setChoices(saved.stops)
            setCourse(saved)
            setSaveMessage('')
            setError('')
            setPage('course')
          }}
          onDeleteCourse={removeCourse}
          onRenameCourse={(id, title) => void renameCourse(id, title)}
        />
      )}
      {page === 'course' && course && (
        <CoursePage
          course={course}
          choices={choices}
          busy={busy}
          error={error}
          saveMessage={saveMessage}
          onRun={() => {
            if (!loadPerson()) {
              setSaveMessage('先に入力画面で名前を入れてから走ってください。')
              return
            }
            setPage('run')
          }}
          onBack={() => setPage('setup')}
          onSave={storeCourse}
          onRevise={(ids) => void reviseCourse(ids)}
        />
      )}
      {page === 'run' && course && (
        <RunPage
          course={course}
          onExit={() => setPage('setup')}
          onVisited={refreshVisits}
          initialStop={showSaitamaSample ? saitamaSampleStop : undefined}
          initialKm={showSaitamaSample ? 3.2 : 0}
        />
      )}
    </main>
  )
}
