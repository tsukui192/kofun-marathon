import { useCallback, useMemo, useState } from 'react'
import { saitamaSample, saitamaSampleStop } from './data/sampleSaitama.ts'
import { fetchOptimalLoop, fetchRoute } from './lib/api.ts'
import { orderLoop, rankStopSets, toStops } from './lib/course.ts'
import { deleteCourse, loadCourses, loadPerson, loadVisits, rememberPerson, saveCourse } from './lib/storage.ts'
import { CoursePage } from './pages/CoursePage.tsx'
import { RunPage } from './pages/RunPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import type { CoursePlan, CourseStop, Kofun, PlaceHit, Visit } from './types.ts'

type Page = 'setup' | 'course' | 'run'

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

  async function createCourse() {
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
    if (!Number.isFinite(parsedKm) || parsedKm < 1 || parsedKm > 50) {
      setError('距離は1から50のkmで入力してください。')
      return
    }
    setBusy(true)
    try {
      const sets = rankStopSets(start, parsedKm)
      if (sets.length === 0) {
        setError('この近くには、コースにできる古墳が見つかりませんでした。')
        return
      }
      let best: CoursePlan | null = null
      let bestSet: Kofun[] = []
      let bestGap = Number.POSITIVE_INFINITY
      for (const set of sets) {
        const plan = await routeThrough(start, toStops(set), parsedKm)
        const gap = Math.abs(plan.distanceKm - parsedKm)
        if (gap < bestGap) {
          best = plan
          bestSet = set
          bestGap = gap
        }
        if (parsedKm > 0 && gap / parsedKm <= 0.2) break
      }
      if (!best) {
        setError('道順を作れませんでした。しばらくしてからもう一度試してください。')
        return
      }
      setChoices(toStops(bestSet))
      setCourse(best)
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
      setCourse({ ...plan, id: course.id, createdAt: course.createdAt })
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
  }

  function storeCourse() {
    if (!course) return
    const result = saveCourse(course)
    if (!result.ok) {
      setSaveMessage(result.message)
      return
    }
    setCourses(loadCourses())
    setSaveMessage('保存しました。')
  }

  function removeCourse(id: string) {
    const result = deleteCourse(id)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setCourses(loadCourses())
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
          onCreate={() => void createCourse()}
          onOpenCourse={(saved) => {
            setChoices(saved.stops)
            setCourse(saved)
            setSaveMessage('')
            setError('')
            setPage('course')
          }}
          onDeleteCourse={removeCourse}
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
