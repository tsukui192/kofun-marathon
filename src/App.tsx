import { useCallback, useState } from 'react'
import { saitamaSample, saitamaSampleStop } from './data/sampleSaitama.ts'
import { fetchOptimalLoop, fetchRoute } from './lib/api.ts'
import { orderLoop, toStops } from './lib/course.ts'
import { deleteCourse, loadCourses, loadVisits, saveCourse } from './lib/storage.ts'
import { CoursePage } from './pages/CoursePage.tsx'
import { RunPage } from './pages/RunPage.tsx'
import { SetupPage } from './pages/SetupPage.tsx'
import type { CoursePlan, Kofun, PlaceHit, Visit } from './types.ts'

type Page = 'setup' | 'course' | 'run'

function shortPlace(label: string): string {
  const head = label.split(',')[0]?.trim()
  return head && head.length > 0 ? head : '選んだ地点'
}

const showSaitamaSample = new URLSearchParams(window.location.search).get('sample') === 'saitama'

export default function App() {
  const [page, setPage] = useState<Page>(showSaitamaSample ? 'run' : 'setup')
  const [start, setStart] = useState<PlaceHit | null>(null)
  const [course, setCourse] = useState<CoursePlan | null>(showSaitamaSample ? saitamaSample : null)
  const [courses, setCourses] = useState<CoursePlan[]>(() => loadCourses())
  const [visits, setVisits] = useState<Visit[]>(() => loadVisits())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')

  const refreshVisits = useCallback(() => setVisits(loadVisits()), [])

  async function createCourse(selected: Kofun[]) {
    setError('')
    setSaveMessage('')
    if (!start) {
      setError('起点を選んでください。')
      return
    }
    if (selected.length === 0) {
      setError('回りたい古墳を選んでください。')
      return
    }
    if (selected.length > 12) {
      setError('一度に選べる古墳は12基までです。')
      return
    }
    setBusy(true)
    try {
      const coordinates: [number, number][] = [
        [start.lng, start.lat],
        ...selected.map((kofun) => [kofun.lng, kofun.lat] as [number, number]),
      ]
      const localOrder = orderLoop(start, selected)
      let stops = toStops(localOrder)
      let route: { distanceMeters: number; line: [number, number][] }
      try {
        const optimal = await fetchOptimalLoop(coordinates)
        const ordered = optimal.order.filter((index) => index > 0).map((index) => selected[index - 1])
        if (ordered.length !== selected.length) throw new Error('順序を確定できませんでした。')
        stops = toStops(ordered)
        route = optimal
      } catch {
        route = await fetchRoute([
          [start.lng, start.lat],
          ...localOrder.map((kofun) => [kofun.lng, kofun.lat] as [number, number]),
          [start.lng, start.lat],
        ])
      }
      const distanceKm = route.distanceMeters / 1000
      setCourse({
        id: crypto.randomUUID(),
        title: `${shortPlace(start.label)} · ${distanceKm.toFixed(1)}km`,
        createdAt: new Date().toISOString(),
        targetKm: distanceKm,
        distanceKm,
        start,
        stops,
        line: route.line,
      })
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
          courses={courses}
          visits={visits}
          busy={busy}
          error={error}
          onStartChange={(place) => {
            setStart(place)
            setError('')
          }}
          onCreate={(selected) => void createCourse(selected)}
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
