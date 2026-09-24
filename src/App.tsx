import { useCallback, useMemo, useState } from 'react'
import { saitamaSample, saitamaSampleStop } from './data/sampleSaitama.ts'
import { fetchRoute } from './lib/api.ts'
import { rankStopSets, toStops } from './lib/course.ts'
import { deleteCourse, loadCourses, loadVisits, saveCourse } from './lib/storage.ts'
import { CoursePage } from './pages/CoursePage.tsx'
import { RunPage } from './pages/RunPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import type { CoursePlan, PlaceHit, Visit } from './types.ts'

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
  const [course, setCourse] = useState<CoursePlan | null>(showSaitamaSample ? saitamaSample : null)
  const [courses, setCourses] = useState<CoursePlan[]>(() => loadCourses())
  const [visits, setVisits] = useState<Visit[]>(() => loadVisits())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const refreshVisits = useCallback(() => setVisits(loadVisits()), [])

  const parsedKm = useMemo(() => Number(targetKm), [targetKm])

  async function createCourse() {
    setError('')
    setSaveMessage('')
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
      let bestGap = Number.POSITIVE_INFINITY
      for (const set of sets) {
        const stops = toStops(set)
        const coordinates: [number, number][] = [
          [start.lng, start.lat],
          ...stops.map((stop) => [stop.lng, stop.lat] as [number, number]),
          [start.lng, start.lat],
        ]
        const route = await fetchRoute(coordinates)
        const distanceKm = route.distanceMeters / 1000
        const gap = Math.abs(distanceKm - parsedKm)
        const plan: CoursePlan = {
          id: crypto.randomUUID(),
          title: `${shortPlace(start.label)} · ${distanceKm.toFixed(1)}km`,
          createdAt: new Date().toISOString(),
          targetKm: parsedKm,
          distanceKm,
          start,
          stops,
          line: route.line,
        }
        if (gap < bestGap) {
          best = plan
          bestGap = gap
        }
        if (parsedKm > 0 && gap / parsedKm <= 0.2) break
      }
      if (!best) {
        setError('道順を作れませんでした。しばらくしてからもう一度試してください。')
        return
      }
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
    deleteCourse(id)
    setCourses(loadCourses())
  }

  return (
    <main>
      {page === 'setup' && (
        <SetupPage
          start={start}
          targetKm={targetKm}
          courses={courses}
          visits={visits}
          busy={busy}
          error={error}
          onStartChange={(place) => {
            setStart(place)
            setError('')
          }}
          onTargetChange={setTargetKm}
          onCreate={() => void createCourse()}
          onOpenCourse={(saved) => {
            setCourse(saved)
            setSaveMessage('')
            setPage('course')
          }}
          onDeleteCourse={removeCourse}
        />
      )}
      {page === 'course' && course && (
        <CoursePage
          course={course}
          saveMessage={saveMessage}
          onRun={() => setPage('run')}
          onBack={() => setPage('setup')}
          onSave={storeCourse}
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
